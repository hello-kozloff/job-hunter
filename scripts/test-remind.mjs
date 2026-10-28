// Тесты напоминаний об откликах (этап 6.3): кандидаты и строки (n8n/shared/remind.js), кнопки (W3), очередь и исходы
// (W9), панель, карточка и вкладка (W7), сводка (W6), сборка. Запуск: node --test scripts/test-remind.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runNode, compile, accessor } from './lib/sandbox.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const ago = (ms) => iso(Date.now() - ms);
const settingRows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));
const settings = (extra = {}) => settingRows({ 'profile.ready': true, 'apply.enabled': true, ...extra });
const TEXT = 'Здравствуйте! Напоминаю про свой отклик.';

const lib = new Function(
  `${['time.js', 'card.js', 'settings.js', 'resumes.js', 'robot.js', 'remind.js'].map((f) => readFileSync(`${root}n8n/shared/${f}`, 'utf8')).join('\n')}
return { remindable, remindCandidates, remindDay, remindLine, remindJournal, REMIND_FINAL };`,
)();

let nextId = 1;
// Отправленный отклик: 5 дней назад, на hh, без напоминания
const sent = (extra = {}) => {
  const id = extra.id ?? nextId++;
  return {
    id,
    external_id: String(138700000 + id),
    title: `Вакансия ${id}`,
    company: 'Ромашка',
    url: `https://hh.ru/vacancy/${138700000 + id}`,
    status: 'applied',
    apply_by: 'robot',
    apply_type: 'hh',
    applied_at: ago(5 * DAY),
    apply_state: '',
    remind_state: '',
    remind_result: '',
    remind_at: '',
    remind_note: '',
    updatedAt: ago(MIN),
    ...extra,
  };
};

// ---------- Кандидаты, строки, журнал (n8n/shared/remind.js) ----------

test('кандидат: отправлен на hh, 3+ дня, не в очереди, итога нет; свежие первыми', () => {
  const now = Date.now();
  assert.ok(lib.remindable(sent(), now));
  assert.ok(!lib.remindable(sent({ applied_at: ago(2 * DAY) }), now), 'моложе 3 дней');
  assert.ok(lib.remindable(sent({ applied_at: iso(now - 3 * DAY) }), now), 'ровно 3 дня');
  assert.ok(lib.remindable(sent({ applied_at: '' }), now), 'без даты отклика — старый');
  assert.ok(!lib.remindable(sent({ status: 'approved' }), now));
  assert.ok(!lib.remindable(sent({ apply_type: 'external' }), now), 'сайт работодателя — чата на hh нет');
  assert.ok(!lib.remindable(sent({ remind_state: 'queued' }), now));
  for (const r of ['sent', 'already', 'viewed', 'invited', 'rejected', 'wrote', 'closed', 'archived', 'no_topic']) {
    assert.ok(!lib.remindable(sent({ remind_result: r }), now), r);
  }
  for (const r of ['error', 'dry_run', 'stopped']) assert.ok(lib.remindable(sent({ remind_result: r }), now), r);
  // «Рано по hh» — снова кандидат только через сутки
  assert.ok(!lib.remindable(sent({ remind_result: 'too_early', remind_at: ago(HOUR) }), now));
  assert.ok(lib.remindable(sent({ remind_result: 'too_early', remind_at: ago(25 * HOUR) }), now));
  const old = sent({ applied_at: ago(20 * DAY) });
  const fresh = sent({ applied_at: ago(4 * DAY) });
  assert.deepEqual(lib.remindCandidates([old, sent({ status: 'waiting' }), fresh], now).map((r) => r.id), [fresh.id, old.id]);
});

test('счёт дня: только отправленные с начала «дня» робота', () => {
  const rows = [sent({ remind_result: 'sent', remind_at: ago(MIN) }), sent({ remind_result: 'viewed', remind_at: ago(MIN) }), sent({ remind_result: 'sent', remind_at: ago(2 * DAY) })];
  assert.equal(lib.remindDay(rows), 1);
});

test('строка карточки: можно, когда можно, очередь, итог', () => {
  assert.equal(lib.remindLine(sent()), '🔔 Можно напомнить работодателю');
  assert.match(lib.remindLine(sent({ applied_at: ago(DAY) })), /^🔔 Напомнить можно с \d\d\.\d\d$/);
  assert.match(lib.remindLine(sent({ remind_state: 'queued' })), /в очереди робота/);
  assert.match(lib.remindLine(sent({ remind_result: 'sent', remind_at: ago(MIN) })), /^🔔 Напомнил \d\d\.\d\d \d\d:\d\d$/);
  assert.match(lib.remindLine(sent({ remind_result: 'viewed', remind_at: ago(MIN) })), /уже открыл отклик/);
  assert.match(lib.remindLine(sent({ remind_result: 'closed', remind_note: 'работодатель отключил переписку' })), /писать нельзя: работодатель отключил/);
  assert.match(lib.remindLine(sent({ remind_result: 'error', remind_at: ago(MIN), remind_note: 'нет поля' })), /не вышло.*нет поля — можно ещё раз/);
  assert.equal(lib.remindLine(sent({ status: 'approved' })), '');
  assert.equal(lib.remindLine(sent({ apply_type: 'external' })), '');
});

test('журнал: последние попытки по remind_at, без «⏹ убрал» и без строк без даты', () => {
  const rows = [
    sent({ title: 'Senior Frontend', remind_result: 'sent', remind_at: ago(MIN) }),
    sent({ remind_result: 'viewed', remind_at: ago(2 * MIN) }),
    sent({ remind_result: 'stopped', remind_at: ago(3 * MIN) }),
    sent({ remind_result: 'closed' }),
  ];
  const j = lib.remindJournal(rows);
  assert.equal(j.length, 2);
  assert.match(j[0], /🔔 Senior Frontend — Ромашка \/v\d+$/);
  assert.match(j[1], /👀 .* · отклик уже открыли \/v\d+$/);
});

// ---------- Кнопки (W3) и задание W9 ----------

const route = async (update) => {
  const $ = (name) => {
    if (name === 'Telegram Trigger') return accessor([{ json: update }]);
    throw new Error(name);
  };
  return (await compile('n8n/w3-telegram/route.js')($, accessor([]), () => ({}), {}))[0]?.json;
};
const press = (data) => ({ callback_query: { id: 'q1', data, message: { message_id: 50, chat: { id: 1 } } } });

test('route: nr:p — панель 🔔; nr:<id>, nr:all, nr:stop — в W9', async () => {
  assert.deepEqual([(await route(press('nr:p'))).action, (await route(press('nr:p'))).view], ['panel', 'remind']);
  const one = await route(press('nr:42'));
  assert.deepEqual([one.action, one.op, one.id, one.queryId], ['robot', 'remind', 42, 'q1']);
  assert.deepEqual([(await route(press('nr:all'))).op, (await route(press('nr:stop'))).op], ['remindall', 'remindstop']);
  assert.equal(await route(press('nr:x')), undefined);
});

test('W9 Job: операции напоминаний — от человека', async () => {
  for (const op of ['remind', 'remindall', 'remindstop']) {
    const [job] = await runNode('n8n/w9-robot/job.js', { input: [{ op, id: 7, queryId: 'q' }], env: { TG_CHAT_ID: '1' } });
    assert.deepEqual([job.op, job.fromUser], [op, true], op);
  }
});

// ---------- Очередь: вторая полоса «Gate» ----------

const gate = (reminders, { s = settings(), queue = [{}], today = [{}], health = {} } = {}) =>
  runNode('n8n/w9-robot/gate.js', {
    nodes: {
      Job: { op: 'tick', fromUser: false },
      Settings: s,
      Queue: queue,
      Today: [{}],
      'Remind queue': reminders.length ? reminders : [{}],
      'Remind today': today,
      Health: { ok: true, busy: false, loggedIn: true, pace: { remindHour: 0, remindHourCap: 10 }, ...health },
    },
  }).then(([out]) => out);
const inQueue = (extra = {}) => sent({ remind_state: 'queued', ...extra });

test('Gate: напоминание — когда отклика нет и робот свободен; текст из настроек; свежие первыми', async () => {
  const older = inQueue({ applied_at: ago(10 * DAY) });
  const fresh = inQueue({ applied_at: ago(4 * DAY) });
  let out = await gate([older, fresh]);
  assert.equal(out.remind.id, fresh.id);
  assert.equal(out.remind.text, TEXT);
  assert.equal(out.remindWait, '');
  out = await gate([fresh], { s: settings({ 'remind.text': 'Добрый день! Напоминаю о себе.' }) });
  assert.equal(out.remind.text, 'Добрый день! Напоминаю о себе.');
});

test('Gate: отклики первыми и все причины ожидания напоминания', async () => {
  const q = [inQueue()];
  const apply = { ...sent({ status: 'approved', letter: 'Письмо' }), apply_state: 'queued', updatedAt: ago(MIN) };
  let out = await gate(q, { queue: [apply] });
  assert.ok(out.next, 'отклик выбран');
  assert.deepEqual([out.remind, out.remindWait], [null, 'busy']);
  assert.equal((await gate(q, { s: settings({ 'apply.enabled': false }) })).remindWait, 'disabled');
  assert.equal((await gate(q, { s: settings({ 'apply.paused': true }) })).remindWait, 'paused');
  assert.equal((await gate(q, { health: { ok: false } })).remindWait, 'down');
  assert.equal((await gate(q, { health: { blocked: { kind: 'captcha', since: ago(MIN) } } })).remindWait, 'blocked');
  assert.equal((await gate(q, { health: { busy: true } })).remindWait, 'busy');
  assert.equal((await gate([...q, sent({ remind_state: 'sending', updatedAt: ago(MIN) })])).remindWait, 'busy', 'уже пишет');
  const today = Array.from({ length: 3 }, () => sent({ remind_result: 'sent', remind_at: ago(MIN) }));
  assert.equal((await gate(q, { s: settings({ 'remind.daily_limit': 10 }), today })).remindWait, '');
  const ten = Array.from({ length: 10 }, () => sent({ remind_result: 'sent', remind_at: ago(MIN) }));
  assert.equal((await gate(q, { s: settings({ 'remind.daily_limit': 10 }), today: ten })).remindWait, 'limit');
  assert.equal((await gate(q, { health: { pace: { nextAt: iso(Date.now() + 30000), remindHour: 0, remindHourCap: 10 } } })).remindWait, 'pace');
  assert.equal((await gate(q, { health: { pace: { remindHour: 10, remindHourCap: 10 } } })).remindWait, 'hour');
  // Ночь — не повод ждать (решение пользователя «когда угодно»); пустая очередь — ни ожидания, ни напоминания
  assert.deepEqual([(await gate([])).remind, (await gate([])).remindWait], [null, '']);
});

test('Gate: починка — отклик отменили (не applied) → снять; sending дольше 6 мин → снова в очередь', async () => {
  const cancelled = inQueue({ status: 'waiting' });
  const stuck = sent({ remind_state: 'sending', updatedAt: ago(7 * MIN) });
  const out = await gate([cancelled, stuck]);
  assert.deepEqual(out.remindHeal, [
    { id: cancelled.id, to: '' },
    { id: stuck.id, to: 'queued' },
  ]);
  assert.equal(out.remind.id, stuck.id, 'зависшее — снова в работе');
});

// ---------- Нажатия: план, «всем», итог ----------

const plan = (row, s = settings()) =>
  runNode('n8n/w9-robot/remind-plan.js', { input: [row], nodes: { Job: { op: 'remind', id: row.id ?? 9, queryId: 'q', chatId: '1' }, Settings: s } }).then(([o]) => o);

test('Remind plan: кандидат — в очередь; иначе подсказка, почему нет', async () => {
  assert.equal((await plan(sent())).save, 'enqueue');
  const why = async (row, s) => (await plan(row, s)).toast;
  assert.match(await why(sent(), settings({ 'apply.enabled': false })), /Робот выключен/);
  assert.match(await why(sent({ status: 'approved' })), /только об отправленном/);
  assert.match(await why(sent({ remind_state: 'queued' })), /Уже в очереди/);
  assert.match(await why(sent({ remind_result: 'sent', remind_at: ago(DAY) })), /Уже напоминал \d\d\.\d\d — напоминание одно/);
  assert.match(await why(sent({ remind_result: 'viewed' })), /уже открыл отклик/);
  assert.match(await why(sent({ applied_at: ago(DAY) })), /Рано: напомнить можно с \d\d\.\d\d/);
  assert.match(await why(sent({ apply_type: 'external' })), /сайте работодателя/);
  assert.match(await why({}), /нет в базе/);
});

test('Remind all: кандидаты — по item; нет — [{ id: 0 }]; робот выключен — off', async () => {
  const a = sent({ applied_at: ago(4 * DAY) });
  const b = sent({ applied_at: ago(9 * DAY) });
  const all = (rows, s = settings()) => runNode('n8n/w9-robot/remind-all.js', { input: rows, nodes: { Settings: s } });
  assert.deepEqual((await all([b, sent({ remind_result: 'sent' }), a])).map((o) => o.id), [a.id, b.id]);
  assert.deepEqual(await all([{}]), [{ id: 0 }]);
  assert.deepEqual(await all([a], settings({ 'apply.enabled': false })), [{ id: 0, off: true }]);
});

test('Remind done: подсказка и тик после записи с условием', async () => {
  const done = (op, input, nodes = {}) =>
    runNode('n8n/w9-robot/remind-done.js', { input, nodes: { Job: { op, id: 5, queryId: 'q', chatId: '1' }, Settings: settings(), ...nodes } }).then(([o]) => o);
  let out = await done('remind', [{ id: 5, remind_state: 'queued' }], { 'Remind plan': { save: 'enqueue' } });
  assert.deepEqual([out.tick, out.queryId], [true, 'q']);
  assert.match(out.toast, /В очереди/);
  assert.equal(out.sync.view, 'sync');
  out = await done('remind', [{ id: 5, save: '' }], { 'Remind plan': { save: '', toast: '👀 уже открыл' } });
  assert.deepEqual([out.tick, out.toast], [false, '👀 уже открыл']);
  out = await done('remind', [{}], { 'Remind plan': { save: 'enqueue' } });
  assert.match(out.toast, /Уже в очереди/, 'второй запуск успел раньше');
  out = await done('remindall', [{ id: 1, remind_state: 'queued' }, { id: 2, remind_state: 'queued' }], { 'Remind all': { id: 1 } });
  assert.match(out.toast, /В очереди 2 — робот напомнит не больше 20 в день/);
  out = await done('remindall', [{}], { 'Remind all': { id: 0 } });
  assert.match(out.toast, /Некому напоминать/);
  out = await done('remindall', [{}], { 'Remind all': { id: 0, off: true } });
  assert.match(out.toast, /Робот выключен/);
  out = await done('remindstop', [{ id: 1, remind_result: 'stopped' }, { id: 2, remind_result: 'stopped' }]);
  assert.deepEqual([out.toast, out.tick], ['⏹ Убрал из очереди напоминаний: 2', false]);
});

// ---------- Исход робота ----------

const result = (res, row = sent({ remind_state: 'sending', hh_chat_id: '' })) =>
  runNode('n8n/w9-robot/remind-result.js', { input: [res], nodes: { Job: { chatId: '1' }, Gate: { remind: row } } }).then(([o]) => o);

test('Remind result: итог — в строку; retry и block — снова в очередь; потолок дня — без самовызова', async () => {
  let out = await result({ statusCode: 200, body: { outcome: 'sent', group: 'done', chatId: '5732977933', pace: { nextAt: iso(Date.now() + 30000) } } });
  assert.deepEqual([out.row.remind_state, out.row.remind_result, out.row.hh_chat_id, out.more], ['', 'sent', '5732977933', true]);
  assert.ok(Date.parse(out.row.remind_at) > Date.now() - MIN);
  assert.ok(out.delay > 20 && out.delay <= 30);
  out = await result({ statusCode: 200, body: { outcome: 'viewed', group: 'skip', note: 'работодатель уже открыл отклик' } });
  assert.deepEqual([out.row.remind_result, out.row.remind_note], ['viewed', 'работодатель уже открыл отклик']);
  out = await result({ statusCode: 409, body: { busy: true } });
  assert.deepEqual([out.group, out.row.remind_state, out.row.remind_at], ['retry', 'queued', '']);
  out = await result({ statusCode: 423, body: { blocked: { kind: 'captcha' } } });
  assert.deepEqual([out.group, out.row.remind_state, out.more], ['block', 'queued', true]);
  out = await result({ statusCode: 429, body: { reason: 'gap', retryAt: iso(Date.now() + 20000) } });
  assert.deepEqual([out.group, out.outcome, out.more], ['retry', 'pace', true]);
  out = await result({ statusCode: 429, body: { reason: 'remind_day' } });
  assert.deepEqual([out.group, out.outcome, out.more], ['block', 'cap', false]);
  out = await result({ statusCode: 500, body: {} });
  assert.deepEqual([out.group, out.row.remind_result, out.row.remind_state, out.more], ['error', 'error', '', false]);
  out = await result({ error: { message: 'ECONNREFUSED' } });
  assert.deepEqual([out.group, out.row.remind_state], ['retry', 'queued']);
});

// ---------- Панель, карточка, вкладка (W7) ----------

const render = (job, { s = {}, rows = [], health, state = {} } = {}) =>
  runNode('n8n/w7-menu/render.js', {
    nodes: {
      Job: { chatId: '1', messageId: 0, userMessageId: 0, queryId: '', tab: '', page: 1, id: 0, ...job },
      Rows: rows.length ? rows : [{}],
      Runs: [{}],
      Settings: settingRows({ 'profile.ready': true, 'apply.enabled': true, ...s }),
      ...(health ? { 'Robot health': health } : {}),
    },
    state,
    env: { USER_TZ: 'Asia/Bangkok' },
  }).then(([out]) => out);

test('W7: «📨 Отправлено» — кнопка панели 🔔 со счётом кандидатов; у напомненных — 🔔 в строке', async () => {
  const rows = [sent(), sent({ remind_result: 'sent', remind_at: ago(MIN) }), sent({ applied_at: ago(DAY) })];
  const out = await render({ view: 'list', tab: 'sent', page: 1 }, { rows });
  assert.equal(out.layout, 'list_sent');
  assert.deepEqual(out.b.remind, { text: '🔔 Напоминания · можно 1', cb: 'nr:p' });
  assert.match(out.text, /\d\d\.\d\d 🔔 · \/v/);
  assert.equal((await render({ view: 'list', tab: 'all', page: 1 }, { rows })).layout, 'list');
});

test('W7: карточка отправленного — 🔔 Напомнить у кандидата, «можно с …» у молодого, итог у напомненного', async () => {
  const fit = sent();
  let out = await render({ view: 'open', id: fit.id }, { rows: [fit] });
  assert.deepEqual([out.layout, out.b.remind], ['open_remind', `nr:${fit.id}`]);
  assert.match(out.text, /🔔 Можно напомнить работодателю/);
  const young = sent({ applied_at: ago(DAY) });
  out = await render({ view: 'open', id: young.id }, { rows: [young] });
  assert.equal(out.layout, 'open_plain');
  assert.match(out.text, /🔔 Напомнить можно с \d\d\.\d\d/);
  const earlier = sent({ my_decision: 'earlier', tg_message_id: 777 });
  assert.equal((await render({ view: 'open', id: earlier.id }, { rows: [earlier] })).layout, 'open_decided_remind');
  // Робот выключен — кнопки нет (нажимать бессмысленно)
  assert.equal((await render({ view: 'open', id: fit.id }, { rows: [fit], s: { 'apply.enabled': false } })).layout, 'open_plain');
});

test('W7: панель 🔔 — кандидаты, сегодня из лимита, очередь, текст, журнал; обновляется на sync', async () => {
  const rows = [
    sent(),
    sent(),
    sent({ remind_state: 'queued' }),
    sent({ title: 'Senior Frontend', remind_result: 'sent', remind_at: ago(MIN) }),
    sent({ remind_result: 'closed', remind_at: ago(2 * MIN) }),
  ];
  const out = await render({ view: 'remind', messageId: 50 }, { rows, health: { ok: true, loggedIn: true, remindLive: false, pace: {} } });
  assert.equal(out.layout, 'remind');
  assert.equal(out.edit, true);
  assert.match(out.text, /Можно напомнить: 2/);
  assert.match(out.text, /Сегодня: 1 из 20 · в очереди: 1/);
  assert.match(out.text, /REMIND_LIVE=0/);
  assert.match(out.text, /Текст: «Здравствуйте! Напоминаю про свой отклик\.»/);
  assert.match(out.text, /🔔 Senior Frontend — Ромашка/);
  assert.deepEqual(out.b.all, { text: '🔔 Напомнить всем (2)', cb: 'nr:all' });
  const panel = { panel: { messageId: 50, view: 'remind', id: 0, tab: 'sent', page: 1 } };
  const synced = await render({ view: 'sync', id: 3 }, { rows, state: panel, health: { ok: true, loggedIn: true } });
  assert.deepEqual([synced.layout, synced.messageId, synced.edit], ['remind', 50, true]);
});

test('W7: ⚙️ → 🚀 Робот — лимит напоминаний; смена лимита толкает W9', async () => {
  const out = await render({ view: 'settings', section: 'apply', messageId: 50 }, { health: { ok: true, loggedIn: true } });
  assert.deepEqual(out.b.rlimit, { text: '🔔 Напоминаний: 20 в день ▸', cb: 'sc:remind.daily_limit' });
  assert.equal((await render({ view: 'settings', section: 'remind', messageId: 50 }, { health: { ok: true } })).layout, 'set_apply');
  const [kick] = await runNode('n8n/w7-menu/robot-kick.js', { nodes: { 'Setting change': [{ name: 'remind.daily_limit', value: 30 }] } });
  assert.equal(kick.op, 'tick');
});

// ---------- Сводка W6 ----------

test('W6: строка напоминаний за сутки — отправлено, пропуски, очередь', async () => {
  const rows = [
    sent({ remind_result: 'sent', remind_at: ago(HOUR) }),
    sent({ remind_result: 'sent', remind_at: ago(HOUR) }),
    sent({ remind_result: 'viewed', remind_at: ago(HOUR) }),
    sent({ remind_result: 'closed', remind_at: ago(HOUR) }),
    sent({ remind_result: 'sent', remind_at: ago(2 * DAY) }),
    sent({ remind_state: 'queued' }),
  ];
  const [out] = await runNode('n8n/w6-summary/summary.js', {
    input: [{ statusCode: 403 }],
    nodes: { 'All rows': rows, Plan: { expire: [], check: [] }, Runs: [{}], Executions: { data: [] }, Settings: settingRows({}), 'Robot health': { ok: true, loggedIn: true } },
    env: { USER_TZ: 'Asia/Bangkok' },
  });
  assert.match(out.text, /🔔 Напоминания: 2 · 👀 1 · 🔒 1 · в очереди 1/);
});

// ---------- Сборка ----------

const built = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../n8n/workflows/${name}.json`, import.meta.url)), 'utf8'));

test('сборка: W9 — 9 выходов «Op», полоса ниже «Next?», тело /remind; W7 — раскладки по порядку, здоровье робота', () => {
  const robot = built('w9-robot');
  const node = (n) => robot.nodes.find((x) => x.name === n);
  assert.equal(node('Op').parameters.numberOutputs, 9);
  assert.ok(node('Remind?').position[1] > node('Next?').position[1], 'отклики первыми (execution order v1 — сверху вниз)');
  assert.match(JSON.stringify(node('Remind').parameters), /\/remind/);
  assert.match(node('Remind').parameters.jsonBody ?? JSON.stringify(node('Remind').parameters), /text.*pace/);
  const links = (from, i = 0) => (robot.connections[from]?.main[i] ?? []).map((c) => c.node);
  assert.deepEqual(links('Op', 6), ['Remind row']);
  assert.deepEqual(links('Op', 7), ['Remind rows']);
  assert.deepEqual(links('Op', 8), ['Remind queued']);
  assert.ok(links('Op', 4).includes('Remind queued'), 'робот выключен — очередь напоминаний тоже снимается');
  assert.deepEqual(links('Remind sync'), ['Panel sync']);
  for (const n of ['Remind queue', 'Remind today']) assert.equal(node(n).executeOnce, true, n);
  const menu = built('w7-menu');
  const layouts = readFileSync(`${root}n8n/w7-menu/render.js`, 'utf8')
    .match(/const LAYOUTS = \[([\s\S]*?)\];/)[1]
    .match(/'[a-z_]+'/g)
    .map((l) => l.slice(1, -1));
  const panels = menu.nodes.filter((n) => n.name.startsWith('Edit: ')).map((n) => n.name.slice(6).replace(/ /g, '_'));
  assert.deepEqual(panels, layouts, 'раскладки render.js ≡ PANEL_LAYOUTS');
  assert.deepEqual(layouts.slice(-4), ['list_sent', 'open_remind', 'open_decided_remind', 'remind']);
  assert.match(JSON.stringify(menu.nodes.find((n) => n.name === 'Robot health?').parameters), /'remind'/);
});

// ---------- Разовая сортировка по переписи «Откликов» (scripts/lib/remind-triage.mjs) ----------

const { planRemindTriage, triageUpdate } = await import('./lib/remind-triage.mjs');
const topic = (vacancyId, extra = {}) => ({ vacancyId: String(vacancyId), chatId: '70' + vacancyId, lastState: 'RESPONSE', viewed: false, chatWrite: 'ENABLED_AFTER_INVITATION', inbox: 'AVAILABLE', ...extra });

test('remind-triage: итог по hh — без визитов робота; не просмотрен — кандидат; нет в переписи — решит робот', () => {
  const rows = [sent({ id: 1, external_id: '11' }), sent({ id: 2, external_id: '12' }), sent({ id: 3, external_id: '13' }), sent({ id: 4, external_id: '14' }), sent({ id: 5, external_id: '15' }), sent({ id: 6, external_id: '16' }), sent({ id: 7, external_id: '17', remind_result: 'sent' }), sent({ id: 8, external_id: '18', status: 'waiting' })];
  const topics = [
    topic(11),
    topic(12, { viewed: true }),
    topic(13, { lastState: 'INTERVIEW' }),
    topic(14, { lastState: 'DISCARD', viewed: true }),
    topic(15, { chatWrite: 'DISABLED', inbox: 'DISABLED_BY_EMPLOYER' }),
    topic(17, { viewed: true }),
    topic(18),
  ];
  const plan = planRemindTriage({ rows, topics });
  assert.deepEqual(plan.mark.map((h) => [h.row.id, h.outcome]), [[2, 'viewed'], [3, 'invited'], [4, 'rejected'], [5, 'closed']]);
  assert.deepEqual(plan.keep.map((h) => h.row.id), [1]);
  assert.deepEqual(plan.missing.map((h) => h.row.id), [6]);
  assert.deepEqual(triageUpdate(plan.mark[0]), { remind_result: 'viewed', remind_note: 'по «Откликам» hh: работодатель уже открыл отклик', hh_chat_id: '7012' });
  assert.deepEqual(triageUpdate(plan.keep[0]), { hh_chat_id: '7011' }, 'кандидату — только chatId, без итога и remind_at');
  // Перепись до 28.10.2026 (без статусов) — ничего не решаем
  assert.equal(planRemindTriage({ rows, topics: [{ vacancyId: '11' }] }).mark.length, 0);
});

test('remind-triage: перепись 28.10.2026 (fixtures, если есть)', { skip: !(await import('node:fs')).existsSync(`${root}fixtures/applier/negotiations-20261028-110847/topics.json`) }, () => {
  const topics = JSON.parse(readFileSync(`${root}fixtures/applier/negotiations-20261028-110847/topics.json`, 'utf8'));
  const rows = topics.map((t, i) => sent({ id: i + 1, external_id: t.vacancyId, applied_at: t.creationTime }));
  const plan = planRemindTriage({ rows, topics });
  assert.equal(plan.mark.length + plan.keep.length, topics.length);
  // Кандидаты переписи 6.3a: не просмотрены, ждут ответа, писать можно (5 с отключённой перепиской — итогом)
  assert.ok(plan.keep.every((h) => h.topic.lastState === 'RESPONSE' && !h.topic.viewed));
  // Писать нельзя (работодатель отключил переписку) — итогом: closed, а у закрытой вакансии — archived
  const disabled = plan.mark.filter((h) => h.topic.chatWrite === 'DISABLED' && h.topic.lastState === 'RESPONSE' && !h.topic.viewed);
  assert.equal(disabled.length, 5);
  assert.ok(disabled.every((h) => ['closed', 'archived'].includes(h.outcome)));
});
