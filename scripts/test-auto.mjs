// Автоотклик (6.1c, 20.10.2026; запуск — node --test scripts/test-auto.mjs): кого робот берёт сам (W9 «Feed»), ворота
// темпа и ночи («Gate»), постановка в очередь без нажатия («Plan»), 429 темпа и пауза перед следующим («Result»),
// остановка (autostop), письма W5, панель 🤖 и кнопки (W3, W7), строка сводки W6, сборка workflow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runNode, compile, accessor } from './lib/sandbox.mjs';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();
const ago = (ms) => iso(Date.now() - ms);
const settingRows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));
// Пояс, в котором сейчас hour:00–hour:59 (тихие часы 23–09 — по поясу из настроек)
const tzAt = (hour) => {
  const d = (((hour - new Date().getUTCHours()) % 24) + 24) % 24;
  const off = d > 12 ? d - 24 : d;
  return off >= 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
};
const DAY_TZ = tzAt(13);
const NIGHT_TZ = tzAt(3);
const settings = (extra = {}) =>
  settingRows({ 'profile.ready': true, 'profile.tz': DAY_TZ, 'apply.enabled': true, 'apply.auto': true, ...extra });

let nextId = 1;
const row = (extra = {}) => {
  const id = extra.id ?? nextId++;
  return {
    id,
    external_id: String(138000000 + id),
    title: `Вакансия ${id}`,
    company: 'К',
    url: `https://hh.ru/vacancy/${138000000 + id}`,
    apply_url: `https://hh.ru/applicant/vacancy_response?vacancyId=${138000000 + id}`,
    apply_type: 'hh',
    has_test: false,
    status: 'waiting',
    decision: 'apply',
    my_decision: '',
    card_at: ago(HOUR),
    tg_message_id: 1000 + id,
    apply_state: '',
    apply_result: '',
    letter: '',
    letter_lock: '',
    ...extra,
  };
};
const letterRow = (extra = {}) => row({ status: 'approved', letter: 'Здравствуйте!', tg_letter_id: 2000 + (extra.id ?? nextId), ...extra });
const gateOut = (extra = {}) => ({ wait: '', today: 0, limit: 80, ...extra });
const feed = (rows, { s = settings(), gate = gateOut(), queue = [] } = {}) =>
  runNode('n8n/w9-robot/feed.js', { input: rows, nodes: { Settings: s, Gate: gate, Queue: queue.length ? queue : [{}] } });

// ---------- Кого брать (Feed, n8n/shared/auto.js) ----------

test('Feed: ✅ с письмом — сразу в очередь, потом свежая карточка apply; мимо — тест, сайт, maybe, решённые, старые', async () => {
  const fresh = row({ card_at: ago(10 * MIN) });
  const older = row({ card_at: ago(2 * HOUR) });
  const ready = letterRow({ card_at: ago(5 * HOUR) });
  const skipped = [
    row({ has_test: true }),
    row({ apply_type: 'external' }),
    row({ decision: 'maybe' }),
    row({ my_decision: 'skip', status: 'skipped' }),
    row({ card_at: ago(4 * 24 * HOUR) }),
    row({ letter_lock: ago(MIN) }),
    letterRow({ apply_result: 'stopped' }),
    letterRow({ apply_result: 'dry_run' }),
  ];
  const out = await feed([older, ...skipped, fresh, ready]);
  assert.deepEqual(out, [
    { kind: 'enqueue', op: 'enqueue', auto: true, id: ready.id },
    { kind: 'claim', id: fresh.id },
  ]);
});

test('Feed: в работе не больше двух, лимит дня — с учётом очереди и пишущихся писем', async () => {
  const a = row();
  const b = row();
  const queued = letterRow({ apply_state: 'queued', apply_mode: 'auto' });
  assert.equal((await feed([a, b], { queue: [queued] })).length, 1, 'одна в очереди — ещё одна');
  const writing = row({ status: 'approved', apply_mode: 'auto', letter_lock: ago(MIN) });
  assert.deepEqual(await feed([a, b, writing], { queue: [queued] }), [], 'очередь + письмо = 2');
  assert.equal((await feed([a, b], { gate: gateOut({ today: 79 }) })).length, 1, 'до лимита дня — одна');
  assert.deepEqual(await feed([a, b], { gate: gateOut({ today: 79 }), queue: [queued] }), []);
});

test('Feed: выкл, пауза, блок, робот не отвечает, лимит, ночь — не берёт; зависший захват чинит всегда', async () => {
  const a = row();
  const stale = row({ status: 'approved', apply_mode: 'auto', letter_lock: ago(11 * MIN) });
  const cases = [
    { s: settings({ 'apply.auto': false }) },
    { s: settings({ 'apply.enabled': false }) },
    { s: settings({ 'apply.paused': true }) },
    { s: settings({ 'profile.tz': NIGHT_TZ }) },
    ...['disabled', 'paused', 'down', 'blocked', 'limit'].map((wait) => ({ gate: gateOut({ wait }) })),
  ];
  for (const c of cases) assert.deepEqual(await feed([a, stale], c), [{ kind: 'unclaim', id: stale.id }], JSON.stringify(c));
  // Робот занят, пауза между откликами, лимит часа — письма пишутся заранее
  for (const wait of ['busy', 'pace', 'hour']) assert.equal((await feed([a], { gate: gateOut({ wait }) })).length, 1, wait);
});

test('Feed: письмо не вышло — ещё раз через 15 мин, всего 2 попытки', async () => {
  const soon = row({ apply_result: 'no_letter', apply_tries: 1, apply_queued_at: ago(5 * MIN) });
  const later = row({ apply_result: 'no_letter', apply_tries: 1, apply_queued_at: ago(16 * MIN) });
  const done = row({ apply_result: 'no_letter', apply_tries: 2, apply_queued_at: ago(HOUR) });
  assert.deepEqual(await feed([soon, later, done]), [{ kind: 'claim', id: later.id }]);
});

test('Feed: хвост выключен — только карточки после включения; выключенное резюме — мимо', async () => {
  const before = row({ card_at: ago(2 * HOUR) });
  const after = row({ card_at: ago(10 * MIN) });
  const s = settings({ 'apply.backlog': false, 'apply.auto_since': ago(HOUR) });
  assert.deepEqual(await feed([before, after], { s }), [{ kind: 'claim', id: after.id }]);
  const off = settings({
    resumes: [
      { id: 'r1', name: 'Основное', active: true, hh: null },
      { id: 'r2', name: 'Второе', active: false, hh: null },
    ],
    'resume.r2': { resume: 'x', in_name: ['x'] },
  });
  const ofOff = row({ resume_id: 'r2' });
  assert.deepEqual(await feed([ofOff], { s: off }), []);
});

// ---------- Ворота (Gate) ----------

const gate = (queue, { s = settings(), health = {}, job = { op: 'tick', fromUser: false } } = {}) =>
  runNode('n8n/w9-robot/gate.js', {
    nodes: { Job: job, Settings: s, Queue: queue, Today: [{}], Health: { ok: true, busy: false, loggedIn: true, ...health } },
  }).then(([out]) => out);
const queued = (extra = {}) => letterRow({ apply_state: 'queued', updatedAt: iso(Date.now()), ...extra });

test('Gate: пауза робота между откликами и лимит часа — ждём; темп из настроек — в pace', async () => {
  const q = [queued()];
  let out = await gate(q);
  assert.equal(out.next.id, q[0].id);
  assert.deepEqual(out.pace, { min: 20, max: 60, hour: 30 });
  assert.equal(out.auto, true);
  out = await gate(q, { health: { pace: { nextAt: iso(Date.now() + 30000), hour: 3 } } });
  assert.equal(out.wait, 'pace');
  assert.equal(out.next, null);
  out = await gate(q, { health: { pace: { nextAt: ago(1000), hour: 30 } } });
  assert.equal(out.wait, 'hour');
  out = await gate(q, { s: settings({ 'apply.pace': 'careful' }), health: { pace: { hour: 8 } } });
  assert.equal(out.wait, 'hour');
  assert.deepEqual(out.pace, { min: 120, max: 300, hour: 8 });
});

test('Gate: ночью автоотклик ждёт, вакансия по 🚀 уходит', async () => {
  const night = settings({ 'profile.tz': NIGHT_TZ });
  const auto = queued({ apply_mode: 'auto', apply_queued_at: ago(2 * MIN) });
  const button = queued({ apply_mode: '', apply_queued_at: ago(MIN) });
  assert.equal((await gate([auto], { s: night })).wait, 'night');
  assert.equal((await gate([auto, button], { s: night })).next.id, button.id);
  assert.equal((await gate([auto, button])).next.id, auto.id, 'днём — по порядку');
});

test('Gate: нажали 🚀 во время паузы робота — письмо говорит, чего ждёт', async () => {
  const q = queued();
  const out = await gate([q], {
    health: { pace: { nextAt: iso(Date.now() + 40000), hour: 1 } },
    job: { op: 'enqueue', id: q.id, fromUser: true, chatId: '1' },
  });
  assert.equal(out.views.length, 1);
  assert.match(out.views[0].text, /Робот ждёт: паузы между откликами \(до \d\d:\d\d\)/);
});

// ---------- В очередь без нажатия (Job, Plan) ----------

test('Job: auto — только у enqueue, это не нажатие', async () => {
  const [a] = await runNode('n8n/w9-robot/job.js', { input: [{ op: 'enqueue', id: 5, auto: true }], env: { TG_CHAT_ID: '1' } });
  assert.equal(a.auto, true);
  assert.equal(a.fromUser, false);
  const [b] = await runNode('n8n/w9-robot/job.js', { input: [{ op: 'enqueue', id: 5 }], env: { TG_CHAT_ID: '1' } });
  assert.equal(b.fromUser, true);
  assert.equal(b.auto, false);
  const [c] = await runNode('n8n/w9-robot/job.js', { input: [{ op: 'autostop' }], env: { TG_CHAT_ID: '1' } });
  assert.equal(c.op, 'autostop');
});

const plan = (r, job, s = settings()) =>
  runNode('n8n/w9-robot/plan.js', { input: [r], nodes: { Job: { chatId: '1', ...job }, Settings: s } }).then(([out]) => out);

test('Plan: автоотклик ставит в очередь с apply_mode = auto, без тоста; выкл, пауза, ⛔, ❌ — нет', async () => {
  const r = letterRow({ apply_tries: 1 });
  let out = await plan(r, { op: 'enqueue', id: r.id, auto: true });
  assert.equal(out.save, 'enqueue');
  assert.equal(out.mode, 'auto');
  assert.equal(out.tries, 0);
  assert.equal(out.toast, '');
  assert.equal(out.layout, 'wait');
  assert.match(out.text, /🤖 Автоотклик: робот откликнется сам/);
  for (const [why, rr, s] of [
    ['выкл', r, settings({ 'apply.auto': false })],
    ['пауза', r, settings({ 'apply.paused': true })],
    ['⛔', { ...r, apply_result: 'stopped' }, settings()],
    ['❌', { ...r, status: 'skipped' }, settings()],
    ['тест', { ...r, has_test: true }, settings()],
  ]) {
    out = await plan(rr, { op: 'enqueue', id: r.id, auto: true }, s);
    assert.equal(out.save, '', why);
    assert.equal(out.layout, '', why);
  }
  // 🚀 — как раньше: mode пустой, счёт сбоев не сбрасывается
  out = await plan(r, { op: 'enqueue', id: r.id, queryId: 'q' });
  assert.equal(out.mode, '');
  assert.equal(out.tries, 1);
  assert.match(out.toast, /Робот откликается/);
});

test('Plan: ⛔ — stopped, письмо снова с 🚀 и пометкой', async () => {
  const r = letterRow({ apply_state: 'queued', apply_mode: 'auto' });
  const out = await plan(r, { op: 'stop', id: r.id, queryId: 'q' });
  assert.equal(out.save, 'unqueue');
  assert.equal(out.layout, 'robot');
  assert.match(out.text, /⛔ Убрал из очереди робота — автоотклик её не возьмёт/);
});

// ---------- Исход (Result) ----------

const result = (res, next = letterRow({ apply_state: 'applying', apply_mode: 'auto', tg_message_id: 77 })) =>
  runNode('n8n/w9-robot/result.js', { input: [res], nodes: { Job: { chatId: '1' }, Gate: { next } } }).then(([out]) => out);

test('Result: отклик ушёл — apply_at, пауза до следующего из ответа робота', async () => {
  const out = await result({
    statusCode: 200,
    body: { outcome: 'applied', group: 'done', letter: 'attached', pace: { nextAt: iso(Date.now() + 30000), hour: 4 } },
  });
  assert.ok(Date.parse(out.row.apply_at) > Date.now() - 5000);
  assert.equal(out.more, true);
  assert.ok(out.delay >= 29 && out.delay <= 30, String(out.delay));
  assert.match(out.text, /🚀 Отправлено 🤖 автооткликом/);
  assert.match(out.card.text, /🤖 Автоотклик/);
});

test('Result: 429 — пауза или лимит часа → назад в очередь, тик после паузы; потолок дня → без петли', async () => {
  let out = await result({ statusCode: 429, body: { reason: 'gap', retryAt: iso(Date.now() + 20000) } });
  assert.equal(out.group, 'retry');
  assert.equal(out.outcome, 'pace');
  assert.equal(out.row.apply_state, 'queued');
  assert.equal(out.row.apply_at, '');
  assert.equal(out.more, true);
  assert.ok(out.delay > 0 && out.delay <= 20);
  out = await result({ statusCode: 429, body: { reason: 'hour', retryAt: iso(Date.now() + 20 * MIN) } });
  assert.equal(out.more, false, 'дольше минуты — подхватит расписание');
  out = await result({ statusCode: 429, body: { reason: 'day', error: 'потолок дня робота' } });
  assert.equal(out.group, 'block');
  assert.equal(out.more, false);
});

test('Dequeue: автоотклик выключили — письма снова с 🚀, stopped; робот выключили — как раньше', async () => {
  const r = letterRow({ apply_state: 'queued', apply_mode: 'auto' });
  const run = (op) => runNode('n8n/w9-robot/dequeue.js', { input: [r], nodes: { Job: { op } }, env: { TG_CHAT_ID: '1' } }).then(([o]) => o);
  let out = await run('autostop');
  assert.equal(out.layout, 'robot');
  assert.equal(out.result, 'stopped');
  out = await run('dequeue');
  assert.equal(out.layout, 'manual');
  assert.equal(out.result, 'disabled');
});

// ---------- Письма (W5) ----------

const format = (job, r = letterRow({ letter: '' }), s = settings(), parsed = { ok: true, letter: 'Здравствуйте!', mode: job.mode ?? 'new' }) =>
  runNode('n8n/w5-letter/format-letter.js', {
    input: [{ id: r.id, ...parsed }],
    nodes: { Jobs: { id: r.id, mode: 'new', ...job }, Vacancy: r, Settings: s },
  }).then(([out]) => out);

test('W5: письмо автоотклика — тихо и в очередь; ✅ при включённом автоотклике — в очередь; «🔄» — нет', async () => {
  let out = await format({ auto: true });
  assert.equal(out.auto, true);
  assert.equal(out.silent, true);
  assert.equal(out.auto_fail, false);
  out = await format({});
  assert.equal(out.auto, true, '✅ пользователя');
  assert.equal(out.silent, false);
  out = await format({ mode: 'redo' }, undefined, undefined, { ok: true, letter: 'Здравствуйте!', mode: 'redo' });
  assert.equal(out.auto, false);
  out = await format({}, undefined, settings({ 'apply.auto': false }));
  assert.equal(out.auto, false);
  out = await format({ auto: true }, letterRow({ letter: '', apply_tries: 1 }), settings(), { ok: false, mode: 'new', problem: '503' });
  assert.equal(out.auto_fail, true);
  assert.equal(out.apply_tries, 2);
});

test('W5 Auto jobs: записанные письма автоотклика → W9 enqueue', async () => {
  const out = await runNode('n8n/w5-letter/auto-jobs.js', {
    input: [{ id: 1 }, { id: 2 }],
    nodes: { 'Format letter': [{ id: 1, auto: true }, { id: 2, auto: false }] },
  });
  assert.deepEqual(out, [{ op: 'enqueue', auto: true, id: 1 }]);
});

// ---------- Кнопки и панель (W3, W7) ----------

const route = async (update) => {
  const $ = (name) => {
    if (name === 'Telegram Trigger') return accessor([{ json: update }]);
    throw new Error(name);
  };
  return (await compile('n8n/w3-telegram/route.js')($, accessor([]), () => ({}), {}))[0]?.json;
};

test('route: «🤖 Автоотклик» и /auto — панель; au:on / au:off — явное значение; au:r — обновить', async () => {
  const msg = (text) => ({ message: { message_id: 3, text, chat: { id: 1 } } });
  assert.equal((await route(msg('🤖 Автоотклик'))).view, 'auto');
  assert.equal((await route(msg('/auto'))).view, 'auto');
  const cb = (data) => ({ callback_query: { id: 'q', data, message: { message_id: 9, chat: { id: 1 } } } });
  assert.deepEqual((await route(cb('au:on'))).change, { name: 'apply.auto', set: true });
  assert.deepEqual((await route(cb('au:off'))).change, { name: 'apply.auto', set: false });
  const r = await route(cb('au:r'));
  assert.equal(r.view, 'auto');
  assert.equal(r.change, undefined);
});

test('Setting change: ▶️ включает робота, снимает паузу, ставит auto_since; повтор — ничего; ⏹ — одна строка', async () => {
  const change = (set, s) =>
    runNode('n8n/w7-menu/setting-change.js', { nodes: { Job: { change: { name: 'apply.auto', set } }, Settings: settingRows(s) } });
  let out = await change(true, { 'apply.paused': true });
  assert.deepEqual(
    out.map((c) => [c.name, c.name === 'apply.auto_since' ? Boolean(Date.parse(c.value)) : c.value]),
    [
      ['apply.auto', true],
      ['apply.auto_since', true],
      ['apply.enabled', true],
      ['apply.paused', false],
    ],
  );
  assert.deepEqual(await change(true, { 'apply.auto': true }), []);
  out = await change(false, { 'apply.auto': true, 'apply.enabled': true });
  assert.deepEqual(out.map((c) => [c.name, c.value]), [['apply.auto', false]]);
});

test('Robot kick: ⏹ автоотклика — autostop, выключили робота — dequeue, ▶️ — tick', async () => {
  const kick = (changes) => runNode('n8n/w7-menu/robot-kick.js', { nodes: { 'Setting change': changes } }).then((o) => o[0]?.op);
  assert.equal(await kick([{ name: 'apply.auto', value: false }]), 'autostop');
  assert.equal(await kick([{ name: 'apply.enabled', value: false }]), 'dequeue');
  assert.equal(await kick([{ name: 'apply.auto', value: true }, { name: 'apply.enabled', value: true }]), 'tick');
  assert.equal(await kick([{ name: 'collect.paused', value: true }]), undefined);
});

const render = (job, { s = {}, rows = [], health, change, state = {} } = {}) =>
  runNode('n8n/w7-menu/render.js', {
    nodes: {
      Job: { chatId: '1', messageId: 0, userMessageId: 0, queryId: '', tab: '', page: 1, id: 0, ...job },
      Rows: rows.length ? rows : [{}],
      Runs: [{}],
      Settings: settingRows({ 'profile.ready': true, 'profile.tz': DAY_TZ, ...s }),
      ...(health ? { 'Robot health': health } : {}),
      ...(change ? { 'Setting change': change } : {}),
    },
    state,
    env: { USER_TZ: 'Asia/Bangkok' },
  }).then(([out]) => out);

test('панель 🤖: выключен — «▶️ Запустить (N)» со счётом; включён — счётчики, журнал, ⏹', async () => {
  const rows = [
    row(),
    letterRow(),
    row({ has_test: true }),
    { ...letterRow({ status: 'applied' }), apply_by: 'robot', apply_mode: 'auto', apply_result: 'applied', apply_letter: 'attached', applied_at: ago(MIN), apply_at: ago(MIN), title: 'Senior Frontend', company: 'Ромашка' },
    { ...letterRow(), apply_result: 'test', apply_at: ago(2 * MIN), title: 'С тестом' },
  ];
  let out = await render({ view: 'auto' }, { s: { 'apply.enabled': true }, rows });
  assert.equal(out.layout, 'auto');
  assert.equal(out.edit, false);
  assert.deepEqual(out.b.toggle, { text: '▶️ Запустить (2)', cb: 'au:on' });
  assert.match(out.text, /Автоотклик<\/b>: ⚪ <b>выключен<\/b>/);
  assert.match(out.text, /Возьмёт: 2 — 🤖 нейросеть 1 · ✅ с письмом 1/);
  assert.match(out.text, /🤖🚀✉️ Senior Frontend — Ромашка \/v\d+/);
  assert.match(out.text, /🧩 С тестом — К · вопросы работодателя — сам/);
  const health = { ok: true, live: true, loggedIn: true, pace: { nextAt: iso(Date.now() + 40000), hour: 5 } };
  out = await render({ view: 'auto', messageId: 9 }, { s: { 'apply.enabled': true, 'apply.auto': true }, rows, health });
  assert.equal(out.edit, true);
  assert.deepEqual(out.b.toggle, { text: '⏹ Остановить', cb: 'au:off' });
  assert.match(out.text, /🟢 <b>работает<\/b>/);
  assert.match(out.text, /Сегодня: 1 из 80 · за час: 5 из 30 · темп: как руками \(20–60 с\)/);
  assert.match(out.text, /Следующий — не раньше \d\d:\d\d · в очереди: 0 · пишу письма: 0/);
});

test('панель 🤖: ночь, блок, сухой прогон — видно, чего ждёт; ▶️ — «✅ Записал»', async () => {
  const on = { 'apply.enabled': true, 'apply.auto': true };
  let out = await render({ view: 'auto' }, { s: { ...on, 'profile.tz': NIGHT_TZ }, health: { ok: true, live: true, loggedIn: true } });
  assert.match(out.text, /🌙 ночь/);
  out = await render({ view: 'auto' }, { s: on, health: { ok: true, live: true, loggedIn: true, blocked: { kind: 'captcha' } } });
  assert.match(out.text, /ждёт капчу hh/);
  out = await render({ view: 'auto' }, { s: on, health: { ok: true, live: false, loggedIn: true } });
  assert.match(out.text, /APPLY_LIVE=0/);
  out = await render({ view: 'auto', messageId: 9 }, { s: {}, change: [{ name: 'apply.auto', value: true }, { name: 'apply.enabled', value: true }] });
  assert.match(out.text, /🟢/);
  assert.match(out.text, /✅ Записал/);
});

test('панель 🤖 обновляется после отклика робота, только если она текущая', async () => {
  const panel = (view) => ({ panel: { messageId: 50, view, id: 0, tab: 'all', page: 1 } });
  const out = await render({ view: 'sync', id: 7 }, { state: panel('auto') });
  assert.equal(out.layout, 'auto');
  assert.equal(out.messageId, 50);
  assert.equal(out.edit, true);
  assert.equal(await render({ view: 'sync', id: 7 }, { state: panel('list') }), undefined);
});

// ---------- Сводка W6 ----------

test('W6: строка робота — сколько автооткликом, ⛔ и «письмо не вышло»', async () => {
  const rows = [
    { ...letterRow({ status: 'applied' }), apply_by: 'robot', apply_mode: 'auto', apply_letter: 'attached', applied_at: ago(HOUR), apply_at: ago(HOUR) },
    { ...letterRow({ status: 'applied' }), apply_by: 'robot', apply_mode: '', apply_letter: 'chat', applied_at: ago(HOUR), apply_at: ago(HOUR) },
    { ...letterRow(), apply_result: 'stopped', apply_at: ago(HOUR) },
    row({ apply_result: 'no_letter', apply_at: ago(HOUR) }),
  ];
  const [out] = await runNode('n8n/w6-summary/summary.js', {
    input: [{ statusCode: 403 }],
    nodes: {
      'All rows': rows,
      Plan: { expire: [], check: [] },
      Runs: [{}],
      Executions: { data: [] },
      Settings: settingRows({ 'apply.enabled': true, 'apply.auto': true }),
      'Robot health': { ok: true, loggedIn: true },
    },
    env: { USER_TZ: 'Asia/Bangkok' },
  });
  assert.match(out.text, /🚀 Робот: 2 \(🤖 авто 1 · ✉️ 1 · 💬 1\) · ⛔ убрал 1 · ✉️ письмо не вышло 1 · 🤖 автоотклик вкл/);
});

// ---------- Сборка ----------

const built = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../n8n/workflows/${name}.json`, import.meta.url)), 'utf8'));

test('сборка: кнопка «🤖 Автоотклик» под полем ввода, раскладка auto, ветка Feed и пауза W9', () => {
  const menu = built('w7-menu');
  const start = menu.nodes.find((n) => n.name === 'New: start');
  assert.match(JSON.stringify(start.parameters.replyKeyboard), /🤖 Автоотклик/);
  assert.ok(menu.nodes.find((n) => n.name === 'New: auto'));
  // Выходы «Layout» = раскладки render.js × 2 + приветствие + вопрос
  const layouts = readFileSync(fileURLToPath(new URL('../n8n/w7-menu/render.js', import.meta.url)), 'utf8')
    .match(/const LAYOUTS = \[([\s\S]*?)\];/)[1]
    .match(/'[a-z_]+'/g);
  assert.equal(menu.nodes.find((n) => n.name === 'Layout').parameters.numberOutputs, layouts.length * 2 + 2);
  assert.equal(layouts.at(-1), "'auto'");
  const robot = built('w9-robot');
  const names = robot.nodes.map((n) => n.name);
  for (const n of ['Auto on?', 'Auto rows', 'Feed', 'Auto claim', 'Write letter', 'Auto enqueue', 'Auto unclaim', 'Pace wait', 'Auto queued']) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(robot.nodes.find((n) => n.name === 'Auto enqueue').parameters.mode, 'each');
  // Пустая очередь не обрывает тик: при автоотклике «Gate» и «Feed» работают и без очереди
  assert.equal(robot.nodes.find((n) => n.name === 'Queue').alwaysOutputData, true);
  assert.deepEqual(robot.connections.Queue.main[0].map((c) => c.node), ['Work?']);
  assert.deepEqual(robot.connections['Work?'].main[0].map((c) => c.node), ['Today']);
  assert.match(robot.nodes.find((n) => n.name === 'Apply').parameters.jsonBody ?? JSON.stringify(robot.nodes.find((n) => n.name === 'Apply').parameters), /pace/);
  // «Auto on?» выше «Next?»: письма к следующим пишутся до отклика (execution order v1 — сверху вниз)
  const y = (n) => robot.nodes.find((x) => x.name === n).position[1];
  assert.ok(y('Auto on?') < y('Next?'));
  const letter = built('w5-letter');
  assert.ok(letter.nodes.find((n) => n.name === 'Auto fail'));
  assert.equal(letter.nodes.find((n) => n.name === 'Robot queue').parameters.mode, 'each');
});

// ---------- Без сообщений в чате (20.10.2026: «в чате спам — хочу открыть панель и видеть журнал») ----------

test('тихо: письмо автоотклика не уходит в чат, только записывается и встаёт в очередь', async () => {
  const out = await format({ auto: true });
  assert.equal(out.quiet, true);
  assert.equal(out.auto, true);
  assert.equal((await format({})).quiet, false, '✅ пользователя — письмо в чат, как раньше');
  const w5 = built('w5-letter');
  assert.deepEqual(w5.connections['Quiet?'].main[0].map((c) => c.node), ['Quiet letter']);
  assert.deepEqual(w5.connections['Quiet letter'].main[0].map((c) => c.node), ['Auto jobs']);
  assert.deepEqual(w5.connections['Auto failed?'].main[1].map((c) => c.node), ['Quiet?']);
});

test('тихо: без сообщения с письмом — ни правки, ни скриншота; ✅ с таким письмом Feed берёт', async () => {
  const r = letterRow({ tg_letter_id: 0 });
  assert.equal((await plan(r, { op: 'enqueue', id: r.id, auto: true })).layout, '');
  const out = await result(
    { statusCode: 200, body: { outcome: 'error', group: 'error', note: 'x', shot: 'a.jpg' } },
    letterRow({ tg_letter_id: 0, apply_state: 'applying', apply_mode: 'auto' }),
  );
  assert.equal(out.layout, '');
  assert.equal(out.shot, '');
  assert.deepEqual(await feed([r]), [{ kind: 'enqueue', op: 'enqueue', auto: true, id: r.id }]);
  const [d] = await runNode('n8n/w9-robot/dequeue.js', { input: [{ ...r, apply_state: 'queued' }], nodes: { Job: { op: 'autostop' } }, env: { TG_CHAT_ID: '1' } });
  assert.equal(d.layout, '');
});

test('тихо: лимит дня при автоотклике — на панели, без сообщения', async () => {
  const q = [queued()];
  const today = Array.from({ length: 10 }, (_, i) => ({ id: 900 + i, apply_by: 'robot', applied_at: iso(Date.now() - MIN) }));
  const run = (s) =>
    runNode('n8n/w9-robot/gate.js', {
      nodes: { Job: { op: 'tick', fromUser: false }, Settings: s, Queue: q, Today: today, Health: { ok: true, loggedIn: true } },
    }).then(([o]) => o);
  let out = await run(settings({ 'apply.daily_limit': 10 }));
  assert.equal(out.wait, 'limit');
  assert.equal(out.notice, null);
  out = await run(settings({ 'apply.daily_limit': 10, 'apply.auto': false }));
  assert.match(out.notice?.text ?? '', /Лимит робота на сегодня/);
});
