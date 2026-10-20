// W6 «Summary» (запуск — node --test scripts/test-w6.mjs): строка теневого режима с метки «🔄 Теневой заново»
// и «ждут оценки» по времени, когда строка стала detailed (19.10.2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNode } from './lib/sandbox.mjs';

const settingRows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));
const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const pair = (id, decision, mine, cardAt) => ({ id, status: 'approved', decision, my_decision: mine, card_at: cardAt, createdAt: cardAt, updatedAt: cardAt });

const summary = (rows, settings = {}) =>
  runNode('n8n/w6-summary/summary.js', {
    input: [{ statusCode: 403 }],
    nodes: {
      'All rows': rows,
      Plan: { expire: [], check: [] },
      Runs: [{}],
      Executions: { data: [] },
      Settings: settingRows(settings),
    },
    env: { USER_TZ: 'Asia/Bangkok' },
  }).then(([out]) => out.text);

test('теневой режим: без метки — вся таблица, с меткой — карточки после неё; от 50 — «пора разбирать»', async () => {
  const rows = [
    pair(1, 'apply', 'apply', '2026-10-10T10:00:00.000Z'),
    pair(2, 'maybe', 'apply', '2026-10-12T10:00:00.000Z'),
    pair(3, 'skip', 'skip', '2026-10-19T10:00:00.000Z'),
  ];
  assert.match(await summary(rows), /🧪 Теневой режим: 3\/50, совпало 2 \(67%\)/);
  assert.match(await summary(rows, { 'llm.shadow_since': '2026-10-19T00:00:00.000Z' }), /🧪 Теневой режим с 19\.10: 1\/50, совпало 1 \(100%\)/);
  const many = Array.from({ length: 50 }, (_, i) => pair(10 + i, 'apply', i % 2 ? 'apply' : 'skip', '2026-10-20T10:00:00.000Z'));
  assert.match(
    await summary(many, { 'llm.shadow_since': '2026-10-19T00:00:00.000Z' }),
    /🧪 Теневой режим с 19\.10: 50\/50, совпало 25 \(50%\) — пора разбирать, напиши Claude/,
  );
});

test('ждут оценки: по времени, когда строка стала detailed, а не когда создана', async () => {
  const now = Date.now();
  const old = (updatedAt) => ({ id: 1, status: 'detailed', createdAt: iso(now - 10 * 24 * HOUR), updatedAt });
  assert.doesNotMatch(await summary([old(iso(now - 5 * 60 * 1000))]), /ждут оценки нейросетью/, 'строка из очереди только что стала detailed');
  assert.match(await summary([old(iso(now - 2 * HOUR))]), /ждут оценки нейросетью: 1/);
});

test('W6 Archive status: 403 со страницей «Вам недоступна эта вакансия» — закрыта, другой 403 — нет', async () => {
  const check = [{ id: 1, status: 'waiting', title: 'А', company: 'К', url: 'https://hh.ru', tg_message_id: 5 }, { id: 2, status: 'waiting', title: 'Б', company: 'К', url: 'https://hh.ru', tg_message_id: 6 }];
  const out = await runNode('n8n/w6-summary/archive-status.js', {
    input: [
      { statusCode: 403, data: '<script>{"luxPageName": "ForbiddenPage"}</script>' },
      { statusCode: 403, data: '<html>qrator</html>' },
    ],
    nodes: { Plan: { check } },
    env: { USER_TZ: 'Asia/Bangkok' },
  });
  assert.deepEqual(out.map((o) => o.id), [1]);
  assert.match(out[0].cardText, /🔒/);
});
