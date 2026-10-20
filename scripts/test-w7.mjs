// W7 (запуск — node --test scripts/test-w7.mjs): теневой режим с нуля (19.10.2026) — кнопка «🔄 Теневой заново»,
// метка llm.shadow_since, строки ⚙️ → 🤖 и 📊 Статистики.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runNode, compile, accessor } from './lib/sandbox.mjs';

const settingRows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));
const pair = (id, decision, mine, cardAt) => ({
  id,
  status: mine === 'skip' ? 'skipped' : 'approved',
  decision,
  my_decision: mine,
  card_at: cardAt,
  createdAt: cardAt,
  tg_message_id: 100 + id,
});
// До метки: 1 совпала, 1 нет; после: 1 совпала, 1 нет; «📨 откликался раньше» не сравниваем
const ROWS = [
  pair(1, 'apply', 'apply', '2026-10-10T10:00:00.000Z'),
  pair(2, 'maybe', 'apply', '2026-10-12T10:00:00.000Z'),
  pair(3, 'skip', 'skip', '2026-10-20T10:00:00.000Z'),
  pair(4, 'apply', 'skip', '2026-10-21T10:00:00.000Z'),
  { id: 5, status: 'applied', decision: 'apply', my_decision: 'earlier', card_at: '2026-10-21T10:00:00.000Z', tg_message_id: 105 },
];
const SINCE = '2026-10-19T00:00:00.000Z';
const job = (fields) => ({ chatId: '1', messageId: 5, userMessageId: 0, queryId: '', tab: '', page: 1, id: 0, ...fields });
const render = (settings, fields, change) =>
  runNode('n8n/w7-menu/render.js', {
    nodes: {
      Job: job(fields),
      Rows: ROWS,
      Runs: [{}],
      Settings: settingRows(settings),
      ...(change ? { 'Setting change': change } : {}),
    },
    env: { USER_TZ: 'Asia/Bangkok' },
  }).then(([out]) => out);

test('route: «🔄 Теневой заново» → панель ⚙️ → 🤖 с изменением llm.shadow_since', async () => {
  const update = { callback_query: { id: 'q1', data: 'sc:llm.shadow_since', from: { username: 'ivan' }, message: { message_id: 9, chat: { id: 1 } } } };
  const $ = (name) => {
    if (name !== 'Telegram Trigger') throw new Error(name);
    return accessor([{ json: update }]);
  };
  const [item] = await compile('n8n/w3-telegram/route.js')($, accessor([]), () => ({}), {});
  assert.equal(item.json.action, 'panel');
  assert.equal(item.json.view, 'settings');
  assert.equal(item.json.section, 'llm');
  assert.deepEqual(item.json.change, { name: 'llm.shadow_since' });
});

test('setting change: метка — текущее время ISO', async () => {
  const before = Date.now();
  const [out] = await runNode('n8n/w7-menu/setting-change.js', {
    nodes: { Job: { change: { name: 'llm.shadow_since' } }, Settings: settingRows({ 'llm.shadow_since': SINCE }) },
  });
  assert.equal(out.name, 'llm.shadow_since');
  assert.ok(Date.parse(out.value) >= before && Date.parse(out.value) <= Date.now());
  assert.equal(JSON.parse(out.value_json), out.value);
  assert.equal(out.previous, SINCE);
});

test('⚙️ → 🤖: без метки — по всем карточкам, с меткой — с даты и времени; кнопка сброса в раскладке', async () => {
  let out = await render({}, { view: 'settings', section: 'llm' });
  assert.equal(out.layout, 'set_llm');
  assert.match(out.text, /Совпадения по всем карточкам: 4\/50, совпало 2 \(50%\)/);
  out = await render({ 'llm.shadow_since': SINCE }, { view: 'settings', section: 'llm' });
  assert.match(out.text, /Совпадения с 19\.10 07:00: 2\/50, совпало 1 \(50%\)/);
  // Только что нажата «🔄 Теневой заново»: панель показывает новую метку («Setting change» — выше «Render»)
  const pressed = '2026-10-22T00:00:00.000Z';
  out = await render(
    { 'llm.shadow_since': SINCE },
    { view: 'settings', section: 'llm', change: { name: 'llm.shadow_since' } },
    { name: 'llm.shadow_since', value: pressed, value_json: JSON.stringify(pressed) },
  );
  assert.match(out.text, /Совпадения с 22\.10 07:00: 0\/50\./);
  assert.match(out.text, /✅ Записал/);
  const built = readFileSync(fileURLToPath(new URL('../n8n/workflows/w7-menu.json', import.meta.url)), 'utf8');
  assert.ok(built.includes('sc:llm.shadow_since') && built.includes('🔄 Теневой заново'));
});

test('📊 Статистика: теневой режим — с метки', async () => {
  let out = await render({}, { view: 'stats' });
  assert.match(out.text, /🧪 Теневой режим: 4\/50, совпало 2 \(50%\)/);
  out = await render({ 'llm.shadow_since': SINCE }, { view: 'stats' });
  assert.match(out.text, /🧪 Теневой режим с 19\.10: 2\/50, совпало 1 \(50%\)/);
});

// Выключенное резюме (20.10.2026): его вакансии в списке не показываем, счётчики вкладок — без них; включили — вернулись
test('📋 Вакансии: вакансии выключенного резюме скрыты, в шапке — сколько скрыто', async () => {
  const rows = [
    { id: 11, status: 'waiting', title: 'Frontend', company: 'A', url: 'https://hh.ru/vacancy/11', createdAt: '2026-10-19T10:00:00.000Z' },
    { id: 12, status: 'waiting', title: 'Fullstack (frontend-резюме)', company: 'B', url: 'https://hh.ru/vacancy/12', createdAt: '2026-10-19T10:00:00.000Z', resume_id: '' },
    { id: 13, status: 'waiting', title: 'Fullstack-разработчик', company: 'C', url: 'https://hh.ru/vacancy/13', createdAt: '2026-10-17T10:00:00.000Z', resume_id: 'r2', resume_name: 'Fullstack-разработчик' },
    { id: 14, status: 'skipped', title: 'Fullstack', company: 'D', url: 'https://hh.ru/vacancy/14', createdAt: '2026-10-17T10:00:00.000Z', resume_id: 'r2' },
  ];
  const resumes = (active) => [
    { id: 'r1', name: 'Frontend-разработчик', active: true, hh: null },
    { id: 'r2', name: 'Fullstack-разработчик', active, hh: null },
  ];
  const list = (active) =>
    runNode('n8n/w7-menu/render.js', {
      nodes: { Job: job({ view: 'list', tab: 'wait' }), Rows: rows, Runs: [{}], Settings: settingRows({ resumes: resumes(active) }) },
      env: { USER_TZ: 'Asia/Bangkok' },
    }).then(([out]) => out);

  const off = await list(false);
  assert.match(off.text, /Ждут решения — 2/);
  assert.match(off.text, /Скрыто 1 — резюме выключено/);
  assert.match(off.text, /\/v11/);
  assert.match(off.text, /\/v12/);
  assert.doesNotMatch(off.text, /\/v13/);
  assert.equal(off.b.tabs.find((t) => t.cb.startsWith('p:l:wait')).text, '• ⏳ 2');

  const on = await list(true);
  assert.match(on.text, /Ждут решения — 3/);
  assert.match(on.text, /\/v13/);
  assert.doesNotMatch(on.text, /Скрыто/);
});

test('список: теневой режим выключен — во «⏳ Ждут решения» только 🟢 и неоценённые, 🟡 и 🔴 — во «📋 Все»', async () => {
  const card = (id, decision) => ({ id, status: 'waiting', decision, card_at: '2026-10-20T10:00:00.000Z', createdAt: '2026-10-20T10:00:00.000Z', title: `В${id}`, company: 'К', url: 'https://hh.ru' });
  const rows = [card(1, 'apply'), card(2, 'maybe'), card(3, 'skip'), card(4, 'error')];
  const list = (settings, tab = 'wait') =>
    runNode('n8n/w7-menu/render.js', {
      nodes: { Job: job({ view: 'list', tab }), Rows: rows, Runs: [{}], Settings: settingRows(settings) },
      env: { USER_TZ: 'Asia/Bangkok' },
    }).then(([out]) => out);
  let out = await list({ 'llm.shadow': false });
  assert.match(out.text, /Ждут решения — 2/);
  assert.match(out.text, /Без 🟡 и 🔴 \(2\) — теневой режим выключен/);
  assert.match(out.text, /В1/);
  assert.doesNotMatch(out.text, /В2|В3/);
  assert.equal(out.b.tabs.find((t) => t.cb.startsWith('p:l:wait')).text.includes('2'), true);
  assert.match((await list({ 'llm.shadow': false }, 'all')).text, /Все — 4/);
  out = await list({});
  assert.match(out.text, /Ждут решения — 4/);
  assert.doesNotMatch(out.text, /теневой режим выключен/);
});
