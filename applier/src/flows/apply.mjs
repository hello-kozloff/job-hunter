// Сценарий отклика на одну вакансию → исход и его группа для n8n (src/hh/state.mjs → GROUP).
//
// До кнопки — проверки: вошли ли, капча, архив, «уже откликались», вопросы работодателя, длина письма, прогноз hh
// (GET popup — тот же запрос, что делает интерфейс при нажатии). APPLY_LIVE=0 или dry — сухой прогон: стоп перед
// кнопкой, скриншот с обведённой кнопкой. APPLY_LIVE=1 — клик и исход по ответам hh (flows/net.mjs), экраны — по
// data-qa из записи 10.10.2026 (docs/stages/stage-6.md → «Запись»):
//   окно с письмом (modal)      письмо в поле → «Откликнуться» → POST popup, response_label «…-with-letter»;
//   отклик в один клик (quick)  отклик уходит сразу → «Приложить сопроводительное письмо» (edit_ajax) →
//                               не вышло (в записи 403 notEditable) → чат отклика: «Добавить сопроводительное»;
//   «другая страна», «может получить отказ», «разрешите работодателям из … видеть профиль» → подтвердить, текст —
//   в warnings (решения пользователя 10–11.10.2026);
//   вопросы работодателя, сайт работодателя, скрытое резюме → человеку; лимит hh, «нарушает правила» → блок.
// Необратимое — только в живом режиме и по одному действию предохранителя (browser.mjs → guardAllow).
// Непонятный экран → error + скриншот, без повторных кликов; 3 живых сбоя подряд → блок errors.
import { config } from '../config.mjs';
import { ensure, guardAllow, guardReset, setGuard, shot, shotOf } from '../browser.mjs';
import { log } from '../log.mjs';
import { store } from '../store.mjs';
import { CHAT_FRAME, HH_PAGE, SEL, TEXT, vacancyUrl } from '../hh/selectors.mjs';
import { GROUP, initialState, isCaptchaPage, isLoginUrl, vacancyFacts } from '../hh/state.mjs';
import { chatResult, letterResult, respondResult, sameText, screenText } from '../hh/xhr.mjs';
import { pause, sleep } from '../util.mjs';
import {
  bodyText,
  captchaKind,
  closeDialogs,
  humanRead,
  predictResponse,
  predictionText,
  shownTall,
  visible,
  visibleWithin,
} from './dom.mjs';
import { watchActions } from './net.mjs';

// Сколько ждать исхода после клика (каждое подтверждение и «Откликнуться» в окне продлевают, но не дальше потолка)
const OUTCOME_MS = 30000;
const OUTCOME_MAX_MS = 75000;
// Лимит hh (200 откликов за 24 ч): блок на 12 часов, дальше робот проверит сам
const LIMIT_MS = 12 * 3600 * 1000;
// Человеческие тексты кодов-стопов hh (переводы vacancy.response.popup.<код>)
const STOP_TEXT = {
  spamDetected: 'Недопустимое сообщение',
  resourcePolicyViolation: 'Не отправилось — нарушает правила сервиса',
  inappropriateLanguage: 'уберите нецензурные слова',
};

// Что из фактов вакансии уходит в ответ (без списков id резюме)
const brief = (f) => ({
  title: f.title,
  company: f.company,
  country: f.country,
  letterRequired: f.letterRequired,
  hasTests: f.hasTests,
  chatWrite: f.chatWrite,
  resumes: f.resumes.unused.length + f.resumes.used.length,
});

// Счётчики «дня» робота: живой отклик ушёл → +1 (потолок APPLIER_DAILY_CAP, server.mjs); живой сбой → серия,
// третий подряд → блок errors (тревога и ▶️ в Telegram); любой другой исход серию обрывает. Сухой прогон не считается
function tally(outcome, live, note) {
  if (!live) return;
  if (outcome === 'applied') store.countApplied();
  else if (outcome !== 'error') store.resetStreak();
  else if (store.countError() >= 3) store.block('errors', { note: note ?? '' });
}

// Капча: картинка с текстом на странице /account/captcha — крупным снимком в Telegram (ответ текстом → POST /captcha).
// Остальное («Я не робот», капча внутри окна отклика) — человеку в окне робота: ответ на фото отправил бы и отклик
async function captchaBlock(page, kind, tag) {
  if (kind === 'captcha' && /\/account\/captcha/.test(page.url())) {
    const name = await shotOf(page.locator(SEL.captchaForm), tag);
    store.block('captcha', { shot: name });
    return name;
  }
  const name = await shot(tag);
  store.block('smart', { shot: name });
  return name;
}

async function closeExtraPages(page) {
  for (const p of page.context().pages()) if (p !== page) await p.close().catch(() => {});
}

// Перепроверка по странице вакансии: hh — истина (usedResumeIds / alreadyApplied)
async function recheck(page, id) {
  try {
    const res = await page.goto(vacancyUrl(id), { waitUntil: 'domcontentloaded', timeout: 30000 });
    return vacancyFacts(initialState((await res?.text().catch(() => '')) ?? ''), id);
  } catch {
    return { applied: false };
  }
}

export async function applyFlow({ vacancyId, letter = '', dry = false }) {
  const id = String(vacancyId).replace(/\D/g, '');
  const live = config.live && !dry;
  const t0 = Date.now();
  const trace = [];
  const step = (s, extra = {}) => trace.push({ s, ms: Date.now() - t0, ...extra });
  const done = (outcome, fields = {}) => {
    const result = { outcome, group: GROUP[outcome], live, ms: Date.now() - t0, trace, ...fields };
    tally(outcome, live, fields.note);
    log('apply', {
      vacancyId: id,
      outcome,
      live,
      via: fields.via,
      letter: fields.letter,
      note: fields.note,
      shot: fields.shot,
      ms: result.ms,
      trace,
    });
    return result;
  };
  if (!id) return done('error', { note: 'нет id вакансии' });

  const page = await ensure();
  // До клика предохранитель закрыт целиком: живой сценарий откроет только свои действия
  setGuard(true);
  guardReset();
  await closeExtraPages(page);

  let res;
  try {
    res = await page.goto(vacancyUrl(id), { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    return done('error', { note: `hh не открылся: ${e.message.split('\n')[0]}` });
  }
  const status = res?.status() ?? 0;
  const html = (await res?.text().catch(() => '')) ?? '';
  step('open', { status });

  const captcha = (await captchaKind(page)) ?? (isCaptchaPage(page.url(), html) ? 'captcha' : null);
  if (captcha) return done('captcha', { shot: await captchaBlock(page, captcha, `captcha-${id}`) });
  if (isLoginUrl(page.url())) {
    store.block('login');
    return done('login', { shot: await shot(`login-${id}`) });
  }

  const state = initialState(html);
  if (!state) return done('error', { note: `нет данных страницы (HTTP ${status})`, shot: await shot(`no-state-${id}`) });
  const facts = vacancyFacts(state, id);
  step('facts', { loggedIn: facts.loggedIn, applied: facts.applied, tests: facts.hasTests, archived: facts.archived });

  if (!facts.found) return done(status === 404 ? 'archived' : 'error', { note: `вакансии нет на hh (HTTP ${status})` });
  if (!facts.loggedIn) {
    store.block('login');
    return done('login', { note: 'робот не вошёл в hh', shot: await shot(`login-${id}`) });
  }
  if (facts.archived || facts.closed) return done('archived', { facts: brief(facts) });
  // hh — истина: отклик уже есть (вручную, через бота или повтор после обрыва связи)
  if (facts.applied) return done('already', { confirmed: true, facts: brief(facts) });
  if (facts.hasTests) return done('test', { note: 'у вакансии вопросы работодателя', facts: brief(facts) });
  // Не закрыта и отклика нет, а hh всё равно не даёт откликнуться (видимость резюме и т. п.) — человеку
  if (facts.responseImpossible) {
    return done('error', { note: 'hh не даёт откликнуться на эту вакансию', facts: brief(facts), shot: await shot(`impossible-${id}`) });
  }
  if (letter.length > facts.letterMax) {
    return done('error', { note: `письмо длиннее ${facts.letterMax} знаков`, facts: brief(facts) });
  }

  const button = page.locator(SEL.applyButton).first();
  if (!(await visibleWithin(button, 15000))) {
    const body = await bodyText(page);
    if (TEXT.responded.test(body)) return done('already', { facts: brief(facts) });
    return done('error', { note: 'на странице нет кнопки «Откликнуться»', shot: await shot(`no-button-${id}`) });
  }
  // Клик до загрузки скриптов hh — переход по ссылке вместо окна отклика (запись: так ушёл отклик в один клик)
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  await humanRead(page);
  step('ready');

  // Прогноз: что hh покажет по «Откликнуться». Тест, «уже», скрытое резюме — ясно без клика
  const predicted = await predictResponse(page, id);
  const prediction = predicted.prediction;
  step('predict', { status: predicted.status, type: prediction?.type ?? null });
  if (prediction?.type === 'alreadyApplied') return done('already', { confirmed: true, facts: brief(facts) });
  if (prediction?.type === 'need-login') {
    store.block('login');
    return done('login', { note: 'hh: нужно войти' });
  }
  if (prediction?.hasTests) return done('test', { note: 'у вакансии вопросы работодателя', facts: brief(facts) });
  if (prediction?.responseAllowed === false) {
    return done('hidden', { note: 'hh просит открыть резюме этому работодателю', facts: brief(facts) });
  }

  if (!live) {
    // Точка сухого прогона: дальше — необратимый клик
    await button.evaluate((el) => {
      el.style.outline = '4px solid #e53935';
      el.style.outlineOffset = '2px';
    });
    return done('dry_run', {
      prediction,
      facts: brief(facts),
      shot: await shot(`dry-${id}`),
      note: predictionText(prediction, facts),
    });
  }

  const net = watchActions(page.context());
  try {
    return await liveApply({ page, id, letter, facts, prediction, net, step, done });
  } catch (e) {
    // Сбой посреди отклика: ничего не повторяем, снимок — человеку (повтор по 🚀 сначала проверит «уже откликались»)
    log('apply.crash', { vacancyId: id, error: e.message.split('\n')[0] });
    return done('error', {
      note: `сбой на шаге ${trace.at(-1)?.s ?? 'старт'}: ${e.message.split('\n')[0].slice(0, 150)}`,
      shot: await shot(`crash-${id}`).catch(() => ''),
    });
  } finally {
    net.stop();
    guardReset();
    await closeExtraPages(page);
  }
}

// Живой отклик после всех проверок: клик → ответ на экраны hh → отклик ушёл → письмо, если не ушло с ним
async function liveApply({ page, id, letter, facts, prediction, net, step, done }) {
  const warnings = new Set();
  const before = await bodyText(page);
  let submitted = false; // в окне отклика нажали «Откликнуться»
  let sentWithLetter = false; // и письмо было в поле
  let confirms = 0;
  let successAt = 0;
  let last = '';
  let ev = null;
  let respond = null;
  // Ответ hh с непонятной ошибкой: ещё 3 с смотрим экран — вдруг hh спросит «Всё равно откликнуться?»
  let failed = null;

  guardAllow('respond', 'quick');
  step('act:click', { type: prediction?.type ?? null });
  await page.locator(SEL.applyButton).first().click({ timeout: 10000 });

  const clickedAt = Date.now();
  let end = clickedAt + OUTCOME_MS;
  const extend = () => {
    end = Math.min(Date.now() + OUTCOME_MS, clickedAt + OUTCOME_MAX_MS);
  };
  while (!ev && Date.now() < end) {
    const got = net.take('respond');
    if (got) {
      const r = respondResult(got.status, got.body, got.post);
      step('respond', { status: got.status, ok: r.ok, code: r.code || undefined, letter: r.letter || undefined });
      if (r.ok || r.outcome !== 'error') {
        [ev, respond] = [got, r];
        break;
      }
      failed = { ev: got, r, at: Date.now() };
    }
    if (failed && Date.now() - failed.at > 3000) {
      [ev, respond] = [failed.ev, failed.r];
      break;
    }
    const screen = await readScreen(page, net, before);
    if (screen.kind !== last) {
      last = screen.kind;
      if (screen.kind !== 'wait') step(`screen:${screen.kind}`);
    }
    switch (screen.kind) {
      case 'external':
        await closeExtraPages(page);
        return done('external', { note: 'отклик на сайте работодателя' });
      case 'captcha':
        return done('captcha', { shot: await captchaBlock(page, screen.captcha, `captcha-${id}`) });
      case 'confirm':
        // «Вакансия в другой стране», «Скорее всего, будет отказ», «Разрешите работодателям из … видеть профиль» —
        // решения пользователя 10–11.10.2026: всегда подтверждать, текст — в отчёт
        if (++confirms > 3) return done('error', { note: 'hh снова и снова просит подтвердить', shot: await shot(`confirm-${id}`) });
        warnings.add(screen.text);
        await pause(700, 1500);
        step('act:confirm');
        await screen.button.click({ timeout: 5000 });
        failed = null;
        extend();
        break;
      case 'questions':
        await closeDialogs(page);
        return done('test', { note: 'hh показал вопросы работодателя', facts: brief(facts) });
      case 'hidden':
        await closeDialogs(page);
        return done('hidden', { note: 'hh просит открыть резюме этому работодателю', facts: brief(facts) });
      case 'modal':
        if (submitted) break;
        {
          const m = await fillModal(page, letter, facts, warnings, step);
          if (m.error) {
            const name = await shot(`modal-${id}`);
            await closeDialogs(page);
            return done('error', { note: m.error, shot: name });
          }
          await pause(800, 2000);
          // Пока вставляли письмо, экран мог смениться (капча в окне, предупреждение): жмём, только если это всё ещё
          // окно отклика, иначе — следующий круг разберёт новый экран (симуляция 11.10.2026 поймала такую гонку)
          const again = await readScreen(page, net, before);
          if (again.kind !== 'modal') break;
          step('act:submit', { letter: m.withLetter });
          await page.locator(SEL.modalSubmit).first().click({ timeout: 5000 });
          submitted = true;
          sentWithLetter = m.withLetter;
          extend();
        }
        break;
      case 'success':
        // Экран «Вы откликнулись», а ответа hh не видно — ещё 5 с, потом перепроверка по странице
        successAt ||= Date.now();
        if (Date.now() - successAt > 5000) end = 0;
        break;
      case 'text':
        if (screen.outcome === 'responded') {
          successAt ||= Date.now();
          if (Date.now() - successAt > 5000) end = 0;
          break;
        }
        return textOutcome(page, id, screen, facts, done);
      default:
        break;
    }
    if (end) await sleep(400);
  }
  if (!ev && failed) [ev, respond] = [failed.ev, failed.r];

  if (!respond?.ok) {
    if (respond && respond.outcome !== 'error') return codeOutcome(page, id, respond, facts, done);
    // Ответа нет или он непонятный — истина на странице вакансии
    const name = await shot(`unclear-${id}`);
    const after = await recheck(page, id);
    step('recheck', { applied: Boolean(after.applied) });
    if (!after.applied) {
      const why = respond
        ? `hh не принял отклик: ${respond.code || (ev.status ? `HTTP ${ev.status}` : 'нет ответа')}`
        : 'исход отклика не ясен';
      return done('error', { note: `${why} — отклика на hh нет`, shot: name });
    }
    // Отклик есть, хотя ответа hh не видно: письмо ушло, если было в поле окна
    respond = { ok: true, letter: sentWithLetter ? 'attached' : 'none', confirmed: true };
  }

  // Отклик ушёл. Письмо не ушло вместе с ним (один клик, окно без поля) — прикладываем, иначе в чат отклика
  let how = respond.letter === 'attached' ? 'attached' : 'none';
  if (how !== 'attached' && letter.trim()) {
    const added = await addLetter(page, letter, net, step);
    how = added.how;
    if (how === 'none') warnings.add(`письмо не приложилось (${added.note}) — добавьте его в чате отклика на hh`);
  }
  const confirmed = respond.confirmed || Boolean((await recheck(page, id)).applied);
  return done('applied', {
    via: submitted ? 'modal' : 'quick',
    letter: how,
    confirmed,
    warnings: [...warnings],
    facts: brief(facts),
  });
}

// Что на экране после клика — по порядку важности. before — текст страницы до клика
async function readScreen(page, net, before) {
  // Новая вкладка не с hh (пока грузится — about:blank) или сама страница ушла с hh — сайт работодателя
  const foreign = net.pages.some((p) => !p.isClosed() && p.url() !== 'about:blank' && !HH_PAGE.test(p.url()));
  if (foreign || !HH_PAGE.test(page.url())) return { kind: 'external' };
  const captcha = await captchaKind(page);
  if (captcha) return { kind: 'captcha', captcha };
  const relocation = page.locator(SEL.relocationConfirm).first();
  if (await visible(relocation)) {
    return { kind: 'confirm', button: relocation, text: await warningText(page, 'Вы откликаетесь на вакансию в другой стране') };
  }
  const force = page.getByRole('button', { name: TEXT.forceApply }).first();
  if (await visible(force)) return { kind: 'confirm', button: force, text: await warningText(page, 'hh предупредил: возможен отказ') };
  // «Разрешите работодателям из <страны> видеть ваш профиль» → «Разрешить и продолжить» (решение пользователя
  // 11.10.2026). Только если на экране именно этот текст: кнопку с тем же названием в другом окне не жмём
  const allow = page.getByRole('button', { name: TEXT.allowCountries }).first();
  if (await visible(allow)) {
    const m = (await bodyText(page)).match(TEXT.otherCountries);
    if (m) return { kind: 'confirm', button: allow, text: `открыл профиль работодателям из ${m[1] ?? m[2]}` };
  }
  if (await visible(page.locator(`${SEL.questions}, ${SEL.taskTextarea}`))) return { kind: 'questions' };
  if (await shownTall(page.locator(SEL.hiddenResume))) return { kind: 'hidden' };
  if (await visible(page.locator(SEL.modalSubmit))) return { kind: 'modal' };
  if (await visible(page.locator(`${SEL.attachLetter}, ${SEL.viewTopic}, ${SEL.success}`))) return { kind: 'success' };
  const text = screenText(await bodyText(page), before);
  if (text) return { kind: 'text', ...text };
  return { kind: 'wait' };
}

// Текст предупреждения hh для отчёта: известная фраза с экрана или запасная
async function warningText(page, fallback) {
  const body = await bodyText(page);
  return body.match(TEXT.relocation)?.[0] ?? body.match(TEXT.rejectWarning)?.[0] ?? fallback;
}

// Окно отклика: сверить резюме, вставить письмо и проверить, что вставилось целиком. → { withLetter } | { error }
async function fillModal(page, letter, facts, warnings, step) {
  const title = (await page.locator(SEL.resumeTitle).first().innerText({ timeout: 2000 }).catch(() => '')).trim();
  if (config.resumeTitle && title && !title.includes(config.resumeTitle)) {
    return { error: `в окне отклика другое резюме: «${title.slice(0, 60)}»` };
  }
  const reject = (await bodyText(page)).match(TEXT.rejectWarning)?.[0];
  if (reject) warnings.add(reject);
  const input = page.locator(SEL.letterInput).first();
  if (letter.trim() && !(await visible(input))) {
    const toggle = page.locator(SEL.letterToggle).first();
    if (await visible(toggle)) {
      await toggle.click({ timeout: 5000 });
      await visibleWithin(input, 5000);
    }
  }
  let withLetter = false;
  if (letter.trim() && (await visible(input))) {
    await pause(700, 1500);
    // fill заменяет текст целиком: hh подставляет в поле прошлое письмо (lastResponseLetter)
    await input.fill(letter);
    if (!sameText(await input.inputValue(), letter)) return { error: 'письмо не вставилось в окно отклика целиком' };
    withLetter = true;
  } else if (facts.letterRequired) {
    return { error: 'письмо обязательно, а поля для него в окне нет' };
  }
  step('modal', { resume: Boolean(title), letter: withLetter });
  return { withLetter };
}

// Ответ hh с кодом ошибки (не «непонятно») → исход и блок
async function codeOutcome(page, id, respond, facts, done) {
  switch (respond.outcome) {
    case 'limit':
      store.block('limit', { until: new Date(Date.now() + LIMIT_MS).toISOString() });
      return done('limit', { note: 'hh: лимит откликов за сутки' });
    case 'blocked': {
      const note = STOP_TEXT[respond.code] ?? respond.code;
      const name = await shot(`stop-${id}`);
      store.block('blocked', { note, shot: name });
      return done('blocked', { note, shot: name });
    }
    case 'already':
      return done('already', { confirmed: true, facts: brief(facts) });
    case 'hidden':
      await closeDialogs(page);
      return done('hidden', { note: 'hh просит открыть резюме этому работодателю', facts: brief(facts) });
    case 'test':
      await closeDialogs(page);
      return done('test', { note: 'hh просит ответить на вопросы', facts: brief(facts) });
    default:
      return done('error', { note: `hh не принял отклик: ${respond.code}`, shot: await shot(`respond-${id}`) });
  }
}

// Текст hh на экране без ответа сети → исход и блок
async function textOutcome(page, id, screen, facts, done) {
  if (screen.outcome === 'limit') {
    store.block('limit', { until: new Date(Date.now() + LIMIT_MS).toISOString() });
    return done('limit', { note: `hh: ${screen.text}` });
  }
  const name = await shot(`text-${id}`);
  if (screen.outcome === 'blocked') {
    store.block('blocked', { note: screen.text, shot: name });
    return done('blocked', { note: screen.text, shot: name });
  }
  await closeDialogs(page);
  if (screen.outcome === 'hidden') return done('hidden', { note: 'hh просит открыть резюме этому работодателю', facts: brief(facts) });
  if (screen.outcome === 'test') return done('test', { note: 'hh просит ответить на вопросы', facts: brief(facts) });
  return done('error', { note: `hh: ${screen.text}`, shot: name });
}

// Письмо к уже отправленному отклику: «Приложить сопроводительное письмо» → не вышло — чат отклика. → { how, note }
async function addLetter(page, letter, net, step) {
  const notes = [];
  const attach = page.locator(SEL.attachLetter).first();
  if (await visibleWithin(attach, 8000)) {
    const r = await attachLetter(page, attach, letter, net, step);
    if (r.ok) return { how: 'attached', note: '' };
    notes.push(`«Приложить»: ${r.note}`);
    await closeDialogs(page);
  } else notes.push('нет «Приложить письмо»');
  const c = await chatLetter(page, letter, net, step);
  if (c.ok) return { how: 'chat', note: '' };
  notes.push(`чат: ${c.note}`);
  return { how: 'none', note: notes.join('; ') };
}

async function attachLetter(page, attach, letter, net, step) {
  guardAllow('letter');
  await pause(800, 1800);
  step('act:attach');
  await attach.click({ timeout: 5000 });
  const input = page.locator(SEL.letterInput).first();
  if (!(await visibleWithin(input, 8000))) return { ok: false, note: 'окно письма не открылось' };
  // «Отклик уже просмотрен работодателем» — приложить уже нельзя
  if (TEXT.viewed.test(await bodyText(page))) return { ok: false, note: 'отклик уже просмотрен' };
  await pause(500, 1200);
  await input.fill(letter);
  if (!sameText(await input.inputValue(), letter)) return { ok: false, note: 'письмо не вставилось' };
  const submit = page.locator(SEL.letterSubmit).first();
  if (!(await visible(submit))) return { ok: false, note: 'нет кнопки «Отправить»' };
  await pause(600, 1500);
  step('act:letter');
  await submit.click({ timeout: 5000 });
  const ev = await net.wait('letter', 12000);
  const r = letterResult(ev?.status ?? 0, ev?.body);
  step('letter', { status: ev?.status ?? 0, code: r.code || undefined });
  return { ok: r.ok, note: r.code };
}

// Чат отклика: у сообщения отклика «Добавить сопроводительное» → поле → «Отправить» (chatik save). Пишется только
// письмо — в само сообщение отклика; переписку робот не ведёт
async function chatLetter(page, letter, net, step) {
  const link = page.locator(SEL.viewTopic).first();
  if (!(await visibleWithin(link, 4000))) return { ok: false, note: 'нет кнопки «Чат»' };
  guardAllow('chat');
  await pause(800, 1800);
  step('act:chat');
  await link.click({ timeout: 5000 });
  const frame = await chatFrame(page, 12000);
  if (!frame) return { ok: false, note: 'чат не открылся' };
  const add = frame.locator(SEL.chatAddLetter).filter({ hasText: TEXT.addLetter }).first();
  if (!(await visibleWithin(add, 12000))) return { ok: false, note: 'нет «Добавить сопроводительное»' };
  await pause(800, 1600);
  step('act:chat-add');
  await add.click({ timeout: 5000 });
  const input = frame.locator(SEL.chatText).first();
  if (!(await visibleWithin(input, 6000))) return { ok: false, note: 'нет поля письма' };
  await input.fill(letter);
  if (!sameText(await input.inputValue(), letter)) return { ok: false, note: 'письмо не вставилось' };
  const send = frame.locator(SEL.chatSend).first();
  if (!(await visibleWithin(send, 4000))) return { ok: false, note: 'нет кнопки «Отправить»' };
  await pause(600, 1400);
  step('act:chat-send');
  await send.click({ timeout: 5000 });
  const ev = await net.wait('chat', 12000);
  const r = chatResult(ev?.status ?? 0);
  step('chat', { status: ev?.status ?? 0 });
  return { ok: r.ok, note: r.code };
}

// Кадр чата отклика: iframe виджета чатов на странице или отдельная вкладка (ждём ≤ ms)
async function chatFrame(page, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const frame = page
      .context()
      .pages()
      .flatMap((p) => p.frames())
      .find((f) => CHAT_FRAME.test(f.url()));
    if (frame) return frame;
    await sleep(300);
  }
  return null;
}
