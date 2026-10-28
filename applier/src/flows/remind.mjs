// Напоминание об отклике (этап 6.3, docs/stages/stage-6.md → «6.3»): свой текст в чат отклика hh — только отклику,
// который ждёт ответа, не просмотрен, старше 3 дней, где писать можно и ещё не писали. Решения пользователя 28.10.2026.
//
// Страница вакансии → отсев по топику отклика без открытия чата (state.mjs → remindFromTopic) → «Чат» → chat_data,
// которые грузит сам кадр (remindFromChat: можно ли писать, не писали ли уже) → поле сообщения.
// REMIND_LIVE=0 или dry — сухой прогон: найти поле, обвести, скриншот; текст не вводится — набор шлёт работодателю
// «печатает…» (participant_action, запись 28.10.2026). REMIND_LIVE=1 — текст → «Отправить» → POST chatik/api/send →
// пузырь сообщения с его id в чате.
// Предохранитель: в сухом прогоне закрыт целиком (чат открывается, «чат открыт» рвётся), в живом открыт только remind —
// отправка, «чат открыт», «печатает…». Перед вводом — сверка, что открылся чат именно этого отклика (28.10.2026 при
// записи напоминание ушло в чат, оставшийся открытым от прошлой страницы).
import { config } from '../config.mjs';
import { ensure, guardAllow, guardReset, setGuard, shot } from '../browser.mjs';
import { log } from '../log.mjs';
import { store } from '../store.mjs';
import { CHAT_DATA_URL, SEL, TEXT, chatMessageSel, vacancyUrl } from '../hh/selectors.mjs';
import {
  REMIND_GROUP,
  initialState,
  isCaptchaPage,
  isForbiddenVacancy,
  isLoginUrl,
  remindFromChat,
  remindFromTopic,
  vacancyFacts,
  vacancyTopic,
} from '../hh/state.mjs';
import { chatSendResult, plain, sameText } from '../hh/xhr.mjs';
import { pause, sleep } from '../util.mjs';
import { captchaBlock } from './apply.mjs';
import { captchaKind, chatFrame, humanRead, visibleWithin } from './dom.mjs';
import { watchActions } from './net.mjs';

// Счётчики «дня» робота: живое напоминание ушло → +1 (потолок APPLIER_REMIND_DAILY_CAP, server.mjs); живой сбой —
// в общую с откликами серию (3 подряд → блок errors); другой исход серию обрывает. Сухой прогон не считается
function tally(outcome, live, note) {
  if (!live) return;
  if (outcome === 'sent') store.countReminded();
  else if (outcome !== 'error') store.resetStreak();
  else if (store.countError() >= 3) store.block('errors', { note: note ?? '' });
}

async function closeExtraPages(page) {
  for (const p of page.context().pages()) if (p !== page) await p.close().catch(() => {});
}

const firstLine = (e) => String(e?.message ?? e).split('\n')[0].slice(0, 150);
const frameText = (frame) => frame.locator('body').innerText().then(plain, () => '');

export async function remindFlow({ vacancyId, text, dry = false, requestId = null }) {
  const id = String(vacancyId).replace(/\D/g, '');
  const live = config.remindLive && !dry;
  const t0 = Date.now();
  const trace = [];
  const step = (s, extra = {}) => trace.push({ s, ms: Date.now() - t0, ...extra });
  // visited — открывали страницы hh: после такой попытки робот держит паузу, как после отклика (server.mjs)
  let visited = false;
  const done = (outcome, fields = {}) => {
    const result = { outcome, group: REMIND_GROUP[outcome], live, visited, ms: Date.now() - t0, trace, ...fields };
    tally(outcome, live, fields.note);
    log('remind', { vacancyId: id, requestId, outcome, live, note: fields.note, chatId: fields.chatId, shot: fields.shot, ms: result.ms, trace });
    return result;
  };
  if (!id) return done('error', { note: 'нет id вакансии' });

  const page = await ensure();
  // До клика по «Чат» предохранитель закрыт целиком: живой сценарий откроет только напоминание
  setGuard(true);
  guardReset();
  await closeExtraPages(page);

  visited = true;
  let res;
  try {
    res = await page.goto(vacancyUrl(id), { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    return done('error', { note: `hh не открылся: ${firstLine(e)}` });
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
  const topic = vacancyTopic(state, id);
  // Что hh знает об отклике — в ответ n8n (без текстов и имён)
  const hh = topic
    ? { lastState: topic.lastState, viewed: topic.viewed, chatWrite: facts.chatWrite, inbox: topic.inbox, createdAt: topic.creationTime }
    : { chatWrite: facts.chatWrite };
  const chatId = topic?.chatId ?? '';
  step('facts', { loggedIn: facts.loggedIn, state: topic?.lastState ?? null, viewed: topic?.viewed ?? null });

  if (!facts.found && isForbiddenVacancy(status, html)) return done('archived', { note: 'вакансия в закрытом режиме — соискателям недоступна' });
  if (!facts.found) return done(status === 404 ? 'archived' : 'error', { note: `вакансии нет на hh (HTTP ${status})` });
  if (!facts.loggedIn) {
    store.block('login');
    return done('login', { note: 'робот не вошёл в hh', shot: await shot(`login-${id}`) });
  }
  const pre = remindFromTopic(facts, topic);
  if (pre) return done(pre.outcome, { note: pre.note, hh, chatId });

  const link = page.locator(SEL.viewTopic).first();
  if (!(await visibleWithin(link, 15000))) return done('error', { note: 'на странице нет кнопки «Чат»', shot: await shot(`no-chat-button-${id}`), hh, chatId });
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  await humanRead(page);
  step('ready');

  const net = watchActions(page.context());
  // chat_data грузит сам кадр чата — ловим его ответ (первый)
  let chatBody = null;
  const onResponse = async (response) => {
    if (chatBody || !CHAT_DATA_URL.test(response.url())) return;
    try {
      chatBody = await response.json();
    } catch {
      // не JSON или тело недоступно — решит разметка чата
    }
  };
  page.context().on('response', onResponse);
  try {
    if (live) guardAllow('remind');
    await pause(800, 1800);
    step('act:chat');
    await link.click({ timeout: 10000 });
    const frame = await chatFrame(page, 15000);
    if (!frame) return done('error', { note: 'чат не открылся', shot: await shot(`no-chat-${id}`), hh, chatId });
    const opened = frame.url().match(/\/chat\/(\d+)/)?.[1] ?? '';
    if (opened !== chatId) {
      return done('error', { note: `открылся чужой чат (${opened || '?'} вместо ${chatId})`, shot: await shot(`wrong-chat-${id}`), hh, chatId });
    }
    for (const end = Date.now() + 10000; !chatBody && Date.now() < end; ) await sleep(250);
    step('chat', { data: Boolean(chatBody) });
    const verdict = remindFromChat(chatBody, text);
    if (verdict) return done(verdict.outcome, { note: verdict.note, hh, chatId });

    const input = frame.locator(SEL.chatText).first();
    if (!(await visibleWithin(input, 8000))) {
      const said = (await frameText(frame)).match(TEXT.chatClosed)?.[0];
      if (said) return done('closed', { note: `hh: ${said}`, hh, chatId });
      return done('error', { note: 'в чате нет поля сообщения', shot: await shot(`no-input-${id}`), hh, chatId });
    }
    if (await input.isDisabled().catch(() => false)) return done('closed', { note: 'поле сообщения неактивно', hh, chatId });

    if (!live) {
      // Точка сухого прогона: дальше — набор («печатает…» у работодателя) и отправка
      await input.evaluate((el) => {
        el.style.outline = '4px solid #e53935';
        el.style.outlineOffset = '2px';
      });
      return done('dry_run', { note: 'поле сообщения найдено, текст не вводил', shot: await shot(`remind-dry-${id}`), hh, chatId });
    }
    return await liveSend({ frame, input, id, text, net, step, done, hh, chatId });
  } catch (e) {
    // Сбой посреди: ничего не повторяем; следующая попытка перед отправкой увидит «уже напомнили»
    log('remind.crash', { vacancyId: id, error: firstLine(e) });
    return done('error', { note: `сбой на шаге ${trace.at(-1)?.s ?? 'старт'}: ${firstLine(e)}`, shot: await shot(`remind-crash-${id}`).catch(() => ''), hh, chatId });
  } finally {
    page.context().off('response', onResponse);
    net.stop();
    guardReset();
    await page.keyboard.press('Escape').catch(() => {});
    await closeExtraPages(page);
  }
}

// Текст → «Отправить» → ответ hh на отправку; ответа нет — сообщение ищем в самом чате
async function liveSend({ frame, input, id, text, net, step, done, hh, chatId }) {
  const ours = frame.locator(SEL.chatMessageText).filter({ hasText: text });
  const before = await ours.count().catch(() => 0);
  await pause(800, 1600);
  step('act:type');
  await input.click({ timeout: 5000 });
  await input.fill(text);
  if (!sameText(await input.inputValue(), text)) {
    await input.fill('').catch(() => {});
    return done('error', { note: 'текст не вставился в поле', shot: await shot(`remind-type-${id}`), hh, chatId });
  }
  await pause(600, 1400);
  step('act:send');
  const send = frame.locator(SEL.chatSend).first();
  if (await visibleWithin(send, 4000)) await send.click({ timeout: 5000 });
  else await input.press('Enter');
  const ev = await net.wait('chatSend', 15000);
  const r = chatSendResult(ev?.status ?? 0, ev?.body);
  step('send', { status: ev?.status ?? 0, ok: r.ok, code: r.code || undefined });
  if (r.ok) {
    const shown = await visibleWithin(frame.locator(chatMessageSel(r.messageId)), 5000);
    return done('sent', { confirmed: shown, messageId: r.messageId, hh, chatId, ...(!shown && { note: 'hh принял сообщение, но в чате его не видно' }) });
  }
  const said = (await frameText(frame)).match(TEXT.stop)?.[0];
  if (r.outcome === 'blocked' || said) {
    const name = await shot(`remind-stop-${id}`);
    store.block('blocked', { note: said ?? r.code, source: 'remind', shot: name });
    return done('blocked', { note: said ?? r.code, shot: name, hh, chatId });
  }
  // Ответа hh не дождались, а сообщение в чате появилось — ушло (повтор всё равно увидит «уже напомнили»)
  if (!ev && (await ours.count().catch(() => 0)) > before) return done('sent', { confirmed: false, note: 'ответа hh не дождался, сообщение в чате', hh, chatId });
  return done('error', { note: `отправка: ${r.code}`, shot: await shot(`remind-error-${id}`), hh, chatId });
}
