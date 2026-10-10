// Разведка (этап 6.0): вакансии и «Отклики» глазами вошедшего соискателя — без единого клика и без записи в hh.
// Сетевой предохранитель включён. Всё сохраняется в /data/recon (= fixtures/applier на Mac, не в git):
// page.html (как есть), state.json (без токенов и личных полей), facts.json, dom.json, popup.json, shot.jpg.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { browserContext, cookies, ensure, setGuard, shot } from '../browser.mjs';
import { log } from '../log.mjs';
import { store } from '../store.mjs';
import { CHATIK, NEGOTIATIONS_URL, WATCH, vacancyUrl } from '../hh/selectors.mjs';
import { initialState, isCaptchaPage, negotiationsSummary, redactState, shape, vacancyFacts } from '../hh/state.mjs';
import { pause, stamp, writeJsonAtomic } from '../util.mjs';
import { captchaShown, predictResponse, watchSelectors } from './dom.mjs';

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
  if (!item.captcha && facts.found) {
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
