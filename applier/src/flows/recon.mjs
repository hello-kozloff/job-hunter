// Разведка (этап 6.0): вакансии и «Отклики» глазами вошедшего соискателя — без единого клика и без записи в hh.
// Сетевой предохранитель включён. Всё сохраняется в /data/recon (= fixtures/applier на Mac, не в git):
// page.html (как есть), state.json (без токенов и личных полей), facts.json, dom.json, popup.json, shot.jpg.
// Резюме (часть D, E0 15.10.2026) — reconResume ниже, со строгим предохранителем. Чаты откликов (6.3a) — reconChats.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { browserContext, cookies, ensure, guardReset, setGuard, shot, strictGuard } from '../browser.mjs';
import { log } from '../log.mjs';
import { store } from '../store.mjs';
import { CHATIK, NEGOTIATIONS_URL, SEL, WATCH, resumeOptionSel, vacancyUrl } from '../hh/selectors.mjs';
import { RESUMES_URL, editLinks, limitsOf, resumeHashes, resumeUrl } from '../hh/resume.mjs';
import {
  chatFacts,
  chatTranslations,
  initialState,
  isCaptchaPage,
  isLoginUrl,
  negotiationCensus,
  negotiationTopics,
  negotiationsSummary,
  redactState,
  shape,
  vacancyFacts,
  vacancyTopic,
} from '../hh/state.mjs';
import { pause, stamp, writeJsonAtomic } from '../util.mjs';
import {
  captchaShown,
  chatFrame,
  chatInputArea,
  closeDialogs,
  formFields,
  humanRead,
  pageHrefs,
  predictResponse,
  shownTall,
  visibleDataQa,
  visibleWithin,
  watchSelectors,
} from './dom.mjs';

export const RECON_DIR = join(config.dataDir, 'recon');
const MAX_VACANCIES = 10;

// Названия экспериментов hh (A/B): форма отклика может отличаться в разных группах
const experimentNames = (state) => {
  const e = state?.experiments;
  if (Array.isArray(e)) return e.map((x) => x?.name ?? x).filter((x) => typeof x === 'string').slice(0, 100);
  return e && typeof e === 'object' ? Object.keys(e).slice(0, 100) : [];
};

async function reconOne(page, id, dir) {
  const item = { id };
  const res = await page.goto(vacancyUrl(id), { waitUntil: 'domcontentloaded', timeout: 45000 });
  item.status = res?.status() ?? 0;
  item.url = page.url();
  const html = (await res?.text().catch(() => '')) ?? '';
  writeFileSync(join(dir, 'page.html'), html);
  item.captcha = isCaptchaPage(page.url(), html) || (await captchaShown(page));
  if (item.captcha) store.block('captcha', { shot: await shot(`captcha-${id}`) });
  const state = initialState(html);
  if (state) writeJsonAtomic(join(dir, 'state.json'), redactState(state));
  const facts = vacancyFacts(state, id);
  writeJsonAtomic(join(dir, 'facts.json'), facts);
  // Кнопке и окнам нужно время дорисоваться после загрузки
  await page.locator('[data-qa="vacancy-response-link-top"]').first().waitFor({ timeout: 8000 }).catch(() => {});
  await pause(1500, 3000);
  item.dom = await watchSelectors(page, WATCH);
  writeJsonAtomic(join(dir, 'dom.json'), item.dom);
  item.finalUrl = page.url();
  // Прогноз — только вошедшему: без входа hh отвечает need-login и, похоже, запоминает «откликнуться после входа»
  if (!item.captcha && facts.found && facts.loggedIn) {
    const predicted = await predictResponse(page, id);
    writeJsonAtomic(join(dir, 'popup.json'), predicted);
    item.popup = { status: predicted.status, prediction: predicted.prediction };
  }
  item.webdriver = await page.evaluate(() => navigator.webdriver).catch(() => null);
  item.experiments = experimentNames(state).length;
  await shot('shot', dir);
  item.facts = {
    loggedIn: facts.loggedIn,
    title: facts.title,
    archived: facts.archived,
    closed: facts.closed,
    applied: facts.applied,
    responseImpossible: facts.responseImpossible,
    hasTests: facts.hasTests,
    letterRequired: facts.letterRequired,
    country: facts.country,
    chatWrite: facts.chatWrite,
    resumes: { used: facts.resumes.used.length, unused: facts.resumes.unused.length, hidden: facts.resumes.hidden.length },
  };
  return item;
}

// Вакансии по списку id: 20–40 с между вакансиями, не больше 10 за раз
export async function reconVacancies(ids, progress = () => {}) {
  const list = [...new Set(ids.map((x) => String(x).replace(/\D/g, '')).filter(Boolean))].slice(0, MAX_VACANCIES);
  const name = `recon-${stamp()}`;
  const root = join(RECON_DIR, name);
  const page = await ensure();
  setGuard(true);
  const items = [];
  for (const [i, id] of list.entries()) {
    progress({ done: i, total: list.length, current: id });
    const dir = join(root, id);
    writeJsonAtomic(join(dir, '.started.json'), { id, at: new Date().toISOString() });
    try {
      items.push(await reconOne(page, id, dir));
    } catch (e) {
      items.push({ id, error: e.message.split('\n')[0] });
    }
    log('recon.vacancy', { id, status: items.at(-1).status, error: items.at(-1).error });
    if (items.at(-1).captcha) break; // капча — дальше не идём
    if (i < list.length - 1) await pause(20000, 40000);
  }
  writeJsonAtomic(join(root, 'summary.json'), items);
  progress({ done: list.length, total: list.length });
  return { dir: `fixtures/applier/${name}`, items };
}

// GET с cookie браузера — тот же контекст, что у окна робота. Только чтение
async function getJson(url) {
  const ctx = browserContext();
  const xsrf = (await cookies()).find((c) => c.name === '_xsrf')?.value;
  const headers = { accept: 'application/json', origin: CHATIK, referer: `${CHATIK}/`, ...(xsrf && { 'x-xsrftoken': xsrf }) };
  try {
    const res = await ctx.request.get(url, { headers, timeout: 30000 });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // не JSON — сохраним начало ответа
    }
    return { status: res.status(), body, raw: body ? undefined : text.slice(0, 500) };
  } catch (e) {
    return { status: 0, error: e.message.split('\n')[0] };
  }
}

// «Отклики» и чаты: страница откликов (InitialState) и список чатов chatik — без открытия чатов.
// Счётчик непрочитанных до и после: чтение списка не должно ничего помечать прочитанным
export async function reconInbox(progress = () => {}) {
  const name = `inbox-${stamp()}`;
  const dir = join(RECON_DIR, name);
  mkdirSync(dir, { recursive: true });
  const page = await ensure();
  setGuard(true);
  const out = { dir: `fixtures/applier/${name}` };

  progress({ step: 'negotiations' });
  const res = await page.goto(NEGOTIATIONS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const html = (await res?.text().catch(() => '')) ?? '';
  writeFileSync(join(dir, 'negotiations.html'), html);
  const state = initialState(html);
  if (state) writeJsonAtomic(join(dir, 'negotiations.state.json'), redactState(state));
  out.negotiations = { status: res?.status() ?? 0, url: page.url(), ...negotiationsSummary(state) };
  out.negotiations.dom = await watchSelectors(page, { item: WATCH.negotiationsItem });
  await shot('negotiations', dir);

  progress({ step: 'chats' });
  const before = await getJson(`${CHATIK}/chatik/api/unread`);
  const chats = await getJson(`${CHATIK}/chatik/api/chats`);
  const after = await getJson(`${CHATIK}/chatik/api/unread`);
  writeJsonAtomic(join(dir, 'chats.json'), chats);
  writeJsonAtomic(join(dir, 'unread.json'), { before, after });
  out.chats = { status: chats.status, error: chats.error, shape: chats.body ? shape(chats.body, 4) : chats.raw };
  out.unread = { before: before.body ?? before.status, after: after.body ?? after.status };
  out.unreadChanged = JSON.stringify(before.body) !== JSON.stringify(after.body);
  writeJsonAtomic(join(dir, 'summary.json'), out);
  log('recon.inbox', { negotiations: out.negotiations.topics, chats: chats.status, unreadChanged: out.unreadChanged });
  return out;
}

// «Отклики» целиком (сверка с таблицей, docs/hh-applied.md): листаем как человек. Страница 1 — по адресу, дальше клик
// по кнопке следующей страницы пейджера (у кнопок нет ссылок), на каждой — чтение с прокруткой и пауза 6–15 с.
// Обычный предохранитель: запись в /applicant/… и chatik (отказ, удаление, «чат открыт») рвётся, а телеметрия и маячки
// hh уходят, как у человека (строгий рвал бы и их — так заметнее). Не-GET запросы страниц — в итог.
// Данные страницы: JSON-ответ hh со списком, пойманный во время клика → свежий InitialState (клик перезагрузил
// страницу) → id вакансий из ссылок списка (без даты). В конце страница 1 ещё раз: отклик, где работодатель что-то
// сделал за время чтения, поднимается наверх. Стоп: капча (блок), выход из hh, страница не переключилась
const MAX_NEGOTIATION_PAGES = 40;
const pagerButton = (n) => `[data-qa~="number-pages-${n}"]`;

export async function readNegotiations({ maxPages = 0 } = {}, progress = () => {}) {
  const name = `negotiations-${stamp()}`;
  const dir = join(RECON_DIR, name);
  mkdirSync(dir, { recursive: true });
  const page = await ensure();
  setGuard(true);
  guardReset();
  const out = { dir: `fixtures/applier/${name}`, pages: [], requests: [], stop: null };
  const byVacancy = new Map();
  const add = (topics) => {
    for (const t of topics) {
      const had = byVacancy.get(t.vacancyId);
      if (!had || (!had.creationTime && t.creationTime)) byVacancy.set(t.vacancyId, t);
    }
  };
  const onRequest = (req) => {
    if (req.method() === 'GET' || out.requests.length >= 200) return;
    const u = new URL(req.url());
    out.requests.push(`${req.method()} ${u.hostname === 'hh.ru' ? '' : u.hostname}${u.pathname}`);
  };
  let caught = [];
  const onResponse = async (res) => {
    try {
      if (!/(^|\.)hh\.ru$/.test(new URL(res.url()).hostname) || !/json/.test(res.headers()['content-type'] ?? '')) return;
      const got = negotiationTopics(await res.json());
      if (got.found) caught.push(got);
    } catch {
      // не JSON или ответ уже недоступен
    }
  };
  const stopped = async (html = '') => {
    if (isCaptchaPage(page.url(), html) || (await captchaShown(page))) {
      store.block('captcha', { shot: await shot('captcha-negotiations') });
      return 'captcha';
    }
    return isLoginUrl(page.url()) ? 'login' : null;
  };
  // id вакансий из ссылок списка откликов (запасной путь — без даты отклика)
  const domTopics = () =>
    page
      .evaluate(() => [
        ...new Set(
          [...document.querySelectorAll('a[href*="hhtmFrom=negotiation_list"]')]
            .map((a) => (a.getAttribute('href') ?? '').match(/\/vacancy\/(\d+)/)?.[1])
            .filter(Boolean),
        ),
      ])
      .then((ids) => ids.map((vacancyId) => ({ topicId: '', vacancyId, creationTime: null, lastModified: null, name: '', companyId: '', company: '' })))
      .catch(() => []);
  // Страница 1 по адресу: InitialState со списком, страницами и счётчиками
  const open = async (step) => {
    progress({ step });
    const res = await page.goto(NEGOTIATIONS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const html = (await res?.text().catch(() => '')) ?? '';
    const stop = await stopped(html);
    if (stop) return { stop };
    const state = initialState(html);
    if (state?.userType && state.userType !== 'applicant') return { stop: 'login' };
    const data = negotiationTopics(state);
    if (!data.found) {
      writeFileSync(join(dir, 'page.html'), html, { mode: 0o600 });
      return { stop: 'нет списка откликов в InitialState (вёрстка hh поменялась?) — page.html' };
    }
    return { data, dom: (await domTopics()).length };
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    const first = await open('страница 1');
    if (first.stop) {
      out.stop = first.stop;
      return out;
    }
    add(first.data.topics);
    out.total = first.data.total;
    out.pageCount = first.data.pageCount;
    out.countersBefore = first.data.counters;
    out.pages.push({ n: 1, source: 'state', topics: first.data.topics.length, dom: first.dom });
    const last = Math.min(first.data.pageCount ?? 1, maxPages > 0 ? maxPages : Infinity, MAX_NEGOTIATION_PAGES);
    for (let n = 2; n <= last; n++) {
      progress({ step: `страница ${n} из ${last}` });
      await humanRead(page);
      await pause(6000, 15000);
      const button = page.locator(pagerButton(n)).first();
      if (!(await visibleWithin(button, 5000))) {
        out.stop = `нет кнопки страницы ${n}`;
        break;
      }
      caught = [];
      await button.scrollIntoViewIfNeeded().catch(() => {});
      await pause(600, 1500);
      await button.click({ timeout: 10000 });
      const switched = await visibleWithin(page.locator(`${pagerButton(n)}[data-qa~="number-pages-selected"]`), 15000);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      out.stop = await stopped();
      if (out.stop) break;
      if (!switched) {
        out.stop = `страница ${n} не открылась`;
        break;
      }
      const dom = await domTopics();
      const fromJson = caught.filter((c) => c.topics.length && (c.selected == null || c.selected === n - 1)).at(-1);
      const fresh = fromJson ? null : negotiationTopics(initialState(await page.content().catch(() => '')));
      const fromState = fresh?.found && fresh.selected === n - 1 ? fresh : null;
      const source = fromJson ? 'json' : fromState ? 'state' : 'dom';
      const topics = fromJson?.topics ?? fromState?.topics ?? dom;
      add(topics);
      out.pages.push({ n, source, topics: topics.length, dom: dom.length });
      log('negotiations.page', { n, source, topics: topics.length, dom: dom.length });
    }
    if (!out.stop && last > 1) {
      await humanRead(page);
      await pause(6000, 15000);
      const again = await open('страница 1 ещё раз');
      if (again.stop) out.stop = again.stop;
      else {
        add(again.data.topics);
        out.countersAfter = again.data.counters;
        out.pages.push({ n: 1, source: 'state', topics: again.data.topics.length, dom: again.dom, again: true });
      }
    }
    return out;
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
    out.read = byVacancy.size;
    out.dated = [...byVacancy.values()].filter((t) => t.creationTime).length;
    // Перепись для напоминаний (6.3a): статусы у работодателя, кандидаты по возрасту и переписке
    out.census = negotiationCensus([...byVacancy.values()]);
    writeJsonAtomic(join(dir, 'topics.json'), [...byVacancy.values()]);
    writeJsonAtomic(join(dir, 'summary.json'), out);
    log('negotiations.done', { pages: out.pages.length, read: out.read, total: out.total, stop: out.stop, candidates: out.census.candidates.total });
    progress({ step: 'готово' });
  }
}

// ---------- Чаты откликов (6.3a, напоминания) ----------

// Что видно в чате отклика глазами соискателя: можно ли писать (поле, предупреждение вместо него, chatStates), кто и
// когда писал, как чат связан с WebSocket. Чат открывается, как у человека, кликом «Чат» на странице вакансии — только у
// отклика без новых сообщений работодателя: иначе они стали бы прочитанными. Обычный предохранитель: «чат открыт»
// (notify_chat_opened) и любая запись в chatik рвутся — порванное в итог. Ничего не вводим: набор текста шлёт
// работодателю «печатает…». Файлы: page.html, state.json, topic.json, chat.html (кадр чата с переводами), chat.json
// (chat_data без текстов и имён), chat-trl.json (переводы chatik.*), dom.json, ws.json (кадры WebSocket), shot.jpg
const MAX_CHATS = 6;
const CHAT_DATA = /^https:\/\/chatik\.hh\.ru\/chatik\/api\/chat_data(?:[?#]|$)/;
const CHAT_UNREAD = /^https:\/\/chatik\.hh\.ru\/chatik\/api\/unread(?:[?#]|$)/;
const firstLine = (e) => String(e?.message ?? e).split('\n')[0].slice(0, 160);
const hostPath = (url) => {
  const u = new URL(url);
  return `${u.hostname === 'hh.ru' ? '' : u.hostname}${u.pathname}`;
};

async function reconChat(page, id, dir) {
  mkdirSync(dir, { recursive: true });
  const item = { id, posts: [], blocked: [], unread: [], ws: [] };
  const frames = { sent: [], received: [] };
  const onRequest = (req) => {
    if (req.method() !== 'GET' && item.posts.length < 50) item.posts.push(`${req.method()} ${hostPath(req.url())}`);
  };
  const onFailed = (req) => {
    if (req.method() !== 'GET' && /BLOCKED_BY_CLIENT/i.test(req.failure()?.errorText ?? '') && item.blocked.length < 50) {
      item.blocked.push(`${req.method()} ${hostPath(req.url())}`);
    }
  };
  const onResponse = async (res) => {
    try {
      if (CHAT_UNREAD.test(res.url())) item.unread.push(await res.json());
      else if (CHAT_DATA.test(res.url()) && !item.chat) {
        const body = await res.json();
        item.chat = chatFacts(body);
        writeJsonAtomic(join(dir, 'chat.json'), { facts: item.chat, shape: shape(body, 4) });
      }
    } catch {
      // не JSON или ответ уже недоступен
    }
  };
  // Кадры WebSocket: сколько и первые по 5 в каждую сторону (до 500 знаков) — понять, не шлёт ли чат сообщения по нему
  const onSocket = (ws) => {
    const entry = { url: ws.url().replace(/\?.*$/, ''), sent: 0, received: 0 };
    item.ws.push(entry);
    ws.on('framesent', (f) => {
      entry.sent++;
      if (frames.sent.length < 5) frames.sent.push(String(f.payload).slice(0, 500));
    });
    ws.on('framereceived', (f) => {
      entry.received++;
      if (frames.received.length < 5) frames.received.push(String(f.payload).slice(0, 500));
    });
  };
  page.on('request', onRequest);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);
  page.on('websocket', onSocket);
  try {
    const res = await page.goto(vacancyUrl(id), { waitUntil: 'domcontentloaded', timeout: 45000 });
    item.status = res?.status() ?? 0;
    const html = (await res?.text().catch(() => '')) ?? '';
    writeFileSync(join(dir, 'page.html'), html, { mode: 0o600 });
    if (isCaptchaPage(page.url(), html) || (await captchaShown(page))) {
      store.block('captcha', { shot: await shot(`captcha-${id}`) });
      return { ...item, stop: 'captcha' };
    }
    if (isLoginUrl(page.url())) return { ...item, stop: 'login' };
    const state = initialState(html);
    if (state) writeJsonAtomic(join(dir, 'state.json'), redactState(state));
    const facts = vacancyFacts(state, id);
    item.facts = { loggedIn: facts.loggedIn, title: facts.title, archived: facts.archived || facts.closed, chatWrite: facts.chatWrite };
    item.topic = vacancyTopic(state, id);
    writeJsonAtomic(join(dir, 'topic.json'), { facts: item.facts, topic: item.topic });
    if (!facts.loggedIn) return { ...item, stop: 'login' };
    if (!item.topic) return { ...item, skipped: 'отклика на hh нет' };
    if (item.topic.hasNewMessages) return { ...item, skipped: 'в чате новые сообщения работодателя — не открываю' };
    await humanRead(page);
    const link = page.locator(SEL.viewTopic).first();
    if (!(await visibleWithin(link, 8000))) {
      await shot('no-chat-button', dir).catch(() => {});
      return { ...item, skipped: 'нет кнопки «Чат»' };
    }
    await pause(800, 1800);
    await link.click({ timeout: 5000 });
    const frame = await chatFrame(page, 15000);
    if (!frame) {
      await shot('no-chat', dir).catch(() => {});
      return { ...item, error: 'чат не открылся' };
    }
    item.frame = frame.url().replace(/\?.*$/, '');
    // Кадр дорисовывается скриптом: поле ввода или предупреждение вместо него
    await frame.waitForLoadState('domcontentloaded').catch(() => {});
    await pause(3000, 5000);
    const chatHtml = await frame.content().catch(() => '');
    writeFileSync(join(dir, 'chat.html'), chatHtml, { mode: 0o600 });
    const trl = chatTranslations(chatHtml);
    writeJsonAtomic(join(dir, 'chat-trl.json'), trl);
    item.translations = Object.keys(trl).length;
    item.input = await chatInputArea(frame).catch((e) => ({ error: firstLine(e) }));
    writeJsonAtomic(join(dir, 'dom.json'), { frame: item.frame, dataQa: await visibleDataQa(frame).catch(() => []), input: item.input });
    await shot('chat', dir);
    return item;
  } finally {
    page.off('request', onRequest);
    page.off('requestfailed', onFailed);
    page.off('response', onResponse);
    page.off('websocket', onSocket);
    writeJsonAtomic(join(dir, 'ws.json'), { sockets: item.ws, frames });
    await page.keyboard.press('Escape').catch(() => {});
  }
}

// Чаты откликов по списку id вакансий: 20–40 с между ними, не больше 6 за раз
export async function reconChats(ids, progress = () => {}) {
  const list = [...new Set(ids.map((x) => String(x).replace(/\D/g, '')).filter(Boolean))].slice(0, MAX_CHATS);
  const name = `chats-${stamp()}`;
  const root = join(RECON_DIR, name);
  const page = await ensure();
  setGuard(true);
  guardReset();
  const items = [];
  try {
    for (const p of page.context().pages()) if (p !== page) await p.close().catch(() => {});
    for (const [i, id] of list.entries()) {
      progress({ done: i, total: list.length, current: id });
      try {
        items.push(await reconChat(page, id, join(root, id)));
      } catch (e) {
        items.push({ id, error: firstLine(e) });
      }
      const it = items.at(-1);
      log('recon.chat', { id, write: it.chat?.write?.allowed ?? null, skipped: it.skipped, error: it.error, stop: it.stop });
      if (it.stop) break;
      if (i < list.length - 1) await pause(20000, 40000);
    }
    return { dir: `fixtures/applier/${name}`, items };
  } finally {
    // Чат — в новой вкладке (если hh открыл его так): закрыть
    for (const p of page.context().pages()) if (p !== page) await p.close().catch(() => {});
    writeJsonAtomic(join(root, 'summary.json'), items);
    progress({ done: list.length, total: list.length });
  }
}

// Резюме (часть D «Экспорт на hh», E0 15.10.2026, docs/recommendations.md): «Мои резюме», страница каждого резюме и
// страницы правки по ссылкам с неё — без кликов. Строгий предохранитель: на время разведки рвём любой не-GET к hh, не
// только к /applicant/ (как hh сохраняет резюме, ещё неизвестно), порванные — в blocked.json: так видно, что страницы
// шлют сами. page.html и state.json каждой страницы — заодно бэкап резюме hh до первой правки.
// Ссылки-действия (удалить, поднять, скрыть, копия) не открываются никогда — hh/resume.mjs → editLinks
const MAX_RESUMES = 3;
const MAX_EDIT_PAGES = 8;

async function reconPage(page, url, dir) {
  mkdirSync(dir, { recursive: true });
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const html = (await res?.text().catch(() => '')) ?? '';
  writeFileSync(join(dir, 'page.html'), html, { mode: 0o600 });
  const item = { url, status: res?.status() ?? 0, finalUrl: page.url() };
  item.captcha = isCaptchaPage(page.url(), html) || (await captchaShown(page));
  if (item.captcha) {
    store.block('captcha', { shot: await shot('captcha-resume') });
    return { item, html: '' };
  }
  const state = initialState(html);
  // Не вошли: hh увёл на вход или отдал страницу гостю (userType в InitialState — anonymous)
  item.login = isLoginUrl(page.url()) || Boolean(state?.userType && state.userType !== 'applicant');
  if (state) {
    const clean = redactState(state);
    writeJsonAtomic(join(dir, 'state.json'), clean);
    item.resumeKeys = Object.keys(clean).filter((k) => /resume/i.test(k));
    item.limits = limitsOf(clean);
  }
  // Части страницы hh дорисовывает скриптом — ждём тишины в сети (не дольше 8 с)
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await pause(1500, 3000);
  const dataQa = await visibleDataQa(page).catch(() => []);
  const fields = await formFields(page).catch(() => []);
  writeJsonAtomic(join(dir, 'dom.json'), { url: page.url(), dataQa, fields });
  item.dataQa = dataQa.length;
  item.fields = fields.filter((x) => x.visible && x.type !== 'hidden').length;
  item.fieldLimits = fields.filter((x) => x.maxLength).length;
  await shot('page', dir, { fullPage: true }).catch(() => shot('page', dir));
  return { item, html: `${html}\n${await pageHrefs(page)}` };
}

export async function reconResume(progress = () => {}) {
  const name = `resume-${stamp()}`;
  const root = join(RECON_DIR, name);
  const page = await ensure();
  setGuard(true);
  const blocked = [];
  const relax = await strictGuard((b) => blocked.length < 500 && blocked.push({ ...b, at: new Date().toISOString() }));
  const out = { dir: `fixtures/applier/${name}`, resumes: [], pages: [] };
  const visit = async (step, url, dir) => {
    progress({ step });
    const { item, html } = await reconPage(page, url, join(root, dir));
    out.pages.push({ name: dir, ...item });
    log('recon.resume', { page: dir, status: item.status, captcha: item.captcha, login: item.login });
    return { item, html };
  };
  try {
    const list = await visit('Мои резюме', RESUMES_URL, 'resumes');
    if (!list.item.captcha && !list.item.login) {
      const hashes = resumeHashes(list.html).slice(0, MAX_RESUMES);
      // Название — текст первой непустой ссылки на резюме в «Моих резюме»
      const titles = await page
        .evaluate(
          (hs) =>
            hs.map((h) => [...document.querySelectorAll(`a[href*="${h}"]`)].map((a) => a.innerText.trim()).find(Boolean) ?? ''),
          hashes,
        )
        .catch(() => hashes.map(() => ''));
      out.resumes = hashes.map((hash, i) => ({ hash, title: String(titles[i] ?? '').replace(/\s+/g, ' ').slice(0, 120) }));
      for (const [i, { hash }] of out.resumes.entries()) {
        await pause(4000, 9000);
        const view = await visit(`резюме ${i + 1} из ${hashes.length}`, resumeUrl(hash), `${hash.slice(0, 8)}/view`);
        if (view.item.captcha || view.item.login) break;
        const links = editLinks(view.html, hash).slice(0, MAX_EDIT_PAGES);
        out.resumes[i].editLinks = links.map((l) => l.replace(hash, '<hash>'));
        for (const [j, link] of links.entries()) {
          await pause(4000, 9000);
          const slug = new URL(link).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
          const edit = await visit(`резюме ${i + 1}: правка ${j + 1} из ${links.length}`, link, `${hash.slice(0, 8)}/edit-${j + 1}-${slug}`);
          if (edit.item.captcha || edit.item.login) break;
        }
        if (out.pages.at(-1)?.captcha || out.pages.at(-1)?.login) break;
      }
    }
  } finally {
    await relax();
    // Что страницы пытались отправить сами: метод и путь, по разу
    out.blocked = blocked.length;
    out.blockedPaths = [...new Set(blocked.map((b) => `${b.method} ${b.host === 'hh.ru' ? '' : b.host}${b.path}`))].slice(0, 30);
    writeJsonAtomic(join(root, 'blocked.json'), blocked);
    writeJsonAtomic(join(root, 'summary.json'), out);
  }
  return out;
}

// ---------- Окно отклика и выбор резюме (этап 5, docs/resumes.md) ----------

// Окна страницы (диалоги, списки, меню) без классов, стилей и картинок — только разметка и data-qa, для разбора
const dialogsHtml = (page) =>
  page.evaluate(() => {
    const roots = [
      ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [role="radiogroup"], [data-qa*="modal"], [data-qa*="popup"], [data-qa*="select"], [data-qa*="resume"]'),
    ];
    const strip = (el) => {
      const copy = el.cloneNode(true);
      copy.querySelectorAll('script, style, svg, img').forEach((n) => n.remove());
      for (const n of [copy, ...copy.querySelectorAll('*')]) {
        n.removeAttribute('class');
        n.removeAttribute('style');
      }
      return copy.outerHTML.replace(/\s+/g, ' ');
    };
    return roots.slice(0, 20).map((r) => ({ role: r.getAttribute('role'), dataQa: r.getAttribute('data-qa'), html: strip(r).slice(0, 80000) }));
  });

async function snapDialog(page, dir, tag) {
  const dataQa = await visibleDataQa(page).catch(() => []);
  const dialogs = await dialogsHtml(page).catch(() => []);
  writeJsonAtomic(join(dir, `${tag}-dialogs.json`), dialogs);
  await shot(tag, dir).catch(() => {});
  return { dataQa, dialogs: dialogs.map((d) => `${d.role ?? '-'} · ${d.dataQa ?? '-'} · ${d.html.length}`) };
}

// Что hh показывает в окне отклика, когда у человека несколько резюме: открываем окно, нажимаем на ячейку резюме,
// выбираем другое резюме, снимаем разметку и скриншоты на каждом шаге, закрываем. Только для вакансии, где hh покажет окно (прогноз type = modal):
// у «в один клик» клик по «Откликнуться» отправил бы отклик сразу. Строгий предохранитель: любой не-GET к hh рвётся.
// «Откликнуться» не нажимается: ничего не отправляется
export async function reconChooser(vacancyId, progress = () => {}) {
  const id = String(vacancyId).replace(/\D/g, '');
  const name = `chooser-${stamp()}`;
  const dir = join(RECON_DIR, name);
  mkdirSync(dir, { recursive: true });
  const out = { id, dir: `fixtures/applier/${name}` };
  const page = await ensure();
  setGuard(true);
  guardReset();
  const blocked = [];
  const relax = await strictGuard((b) => blocked.push(b));
  try {
    for (const p of page.context().pages()) if (p !== page) await p.close().catch(() => {});
    progress({ done: 0, total: 1, current: id });
    const res = await page.goto(vacancyUrl(id), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const html = (await res?.text().catch(() => '')) ?? '';
    if (isCaptchaPage(page.url(), html) || (await captchaShown(page))) {
      store.block('captcha', { shot: await shot(`captcha-${id}`) });
      return { ...out, error: 'captcha' };
    }
    const state = initialState(html);
    const facts = vacancyFacts(state, id);
    out.facts = { loggedIn: facts.loggedIn, applied: facts.applied, archived: facts.archived || facts.closed, hasTests: facts.hasTests, resumes: facts.resumes };
    if (!facts.found || !facts.loggedIn || facts.archived || facts.closed || facts.hasTests) return { ...out, skipped: 'вакансия не подходит для разведки окна (закрыта, тест или не вошли)' };
    await page.locator(SEL.applyButton).first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await humanRead(page);
    const predicted = await predictResponse(page, id);
    out.prediction = predicted.prediction;
    writeJsonAtomic(join(dir, 'popup.json'), predicted);
    if (predicted.prediction?.type !== 'modal') {
      return { ...out, skipped: `hh покажет «${predicted.prediction?.type ?? 'неизвестно'}», а не окно: кликать нельзя — отклик ушёл бы сразу` };
    }
    await pause(1000, 2500);
    await page.locator(SEL.applyButton).first().click({ timeout: 10000 });
    out.modalOpened = await visibleWithin(page.locator(SEL.modalSubmit), 12000);
    if (!out.modalOpened) {
      await shot('no-modal', dir).catch(() => {});
      return { ...out, error: 'окно отклика не открылось' };
    }
    await pause(1200, 2200);
    out.before = await snapDialog(page, dir, 'before');
    // Поле письма (19.10.2026): обязательное — сразу в окне; необязательное — под «Добавить сопроводительное». Кнопка
    // только раскрывает поле, ничего не отправляет (предохранитель всё равно рвёт любую запись) — проверяем, что робот
    // найдёт поле так же, как при отклике (SEL.letterToggle → SEL.letterInput)
    const letterInput = page.locator(SEL.letterInput).first();
    out.letterInput = await letterInput.isVisible().catch(() => false);
    const toggle = page.locator(SEL.letterToggle).first();
    if (!out.letterInput && (await toggle.isVisible().catch(() => false))) {
      await pause(600, 1200);
      await toggle.click({ timeout: 5000 });
      out.letterToggle = true;
      out.letterInput = await visibleWithin(letterInput, 5000);
      out.letter = await snapDialog(page, dir, 'letter');
    }
    // Ячейка резюме в окне — кнопка (role=button), внутри — название резюме
    const cell = page.locator(SEL.resumeTitle).first().locator('xpath=ancestor::*[@role="button"][1]');
    out.cell = (await cell.count().catch(() => 0)) > 0;
    if (out.cell) {
      await cell.click({ timeout: 5000 });
      await pause(1500, 2500);
      out.after = await snapDialog(page, dir, 'after');
      // Выбрать другую опцию (как это сделает отклик) и посмотреть, что стало в окне: название и предупреждение о скрытом
      // резюме. Выбор в окне ничего не отправляет — «Откликнуться» не нажимаем, предохранитель рвёт любую запись
      const other = page.locator('[role="option"][aria-selected="false"][data-qa^="magritte-select-option-"]').first();
      if (await visibleWithin(other, 3000)) {
        out.pickedHash = String(await other.getAttribute('data-qa')).replace('magritte-select-option-', '');
        out.optionTitle = (await other.locator(SEL.resumeTitle).first().innerText().catch(() => '')).trim();
        await pause(800, 1600);
        await other.click({ timeout: 5000 });
        await pause(1200, 2200);
        out.titleAfterPick = (await page.locator(SEL.resumeCurrent).first().innerText().catch(() => '')).trim();
        out.hiddenWarning = await shownTall(page.locator(SEL.hiddenResume));
        out.optionStillThere = await page.locator(resumeOptionSel(out.pickedHash)).first().isVisible().catch(() => false);
        out.picked = await snapDialog(page, dir, 'picked');
      }
    }
    return out;
  } finally {
    // Закрыть всё, что открыли; если окно осталось — уйти со страницы
    await closeDialogs(page);
    await pause(400, 900);
    await closeDialogs(page);
    if (await page.locator(SEL.modalSubmit).first().isVisible().catch(() => false)) await page.goto('https://hh.ru/applicant/resumes').catch(() => {});
    await relax();
    out.blocked = blocked.map((b) => `${b.method} ${b.host}${b.path}`).slice(0, 30);
    writeJsonAtomic(join(dir, 'summary.json'), out);
    progress({ done: 1, total: 1 });
  }
}
