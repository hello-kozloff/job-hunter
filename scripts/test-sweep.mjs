// Разовый догон (запуск — node --test scripts/test-sweep.mjs): node scripts/n8n-api.mjs sweep, логика —
// scripts/lib/sweep.mjs. Сеть и n8n не нужны: код нод W1 — через песочницу тестов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PAGE_REASONS, RETIRED_REASONS, planSweep, reasonKeys, sweepUrl } from './lib/sweep.mjs';

const settingRows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));

test('адрес: тот же запрос W1 за 30 дней, нужная страница', () => {
  const url =
    'https://hh.ru/search/vacancy?text=frontend%20OR%20typescript&professional_role=96&work_format=REMOTE&search_period=1&order_by=publication_time&items_on_page=100&enable_snippets=true&ored_clusters=true&page=0';
  const out = sweepUrl(url, 3);
  assert.equal(new URL(out).searchParams.get('search_period'), '30');
  assert.equal(new URL(out).searchParams.get('page'), '3');
  assert.equal(out.replace('search_period=30', 'search_period=1').replace(/page=3$/, 'page=0'), url, 'остальное — как у W1');
});

test('причины: ключи без цитат; причины со страницы ещё пишет «Parse vacancy», ушедшей — нет', () => {
  assert.deepEqual(reasonKeys('стоп-слово, только из РФ: «только из РФ»'), ['стоп-слово', 'только из РФ']);
  assert.deepEqual(reasonKeys(''), []);
  const code = readFileSync(fileURLToPath(new URL('../n8n/w1-collector/parse-vacancy.js', import.meta.url)), 'utf8');
  for (const reason of PAGE_REASONS) assert.ok(code.includes(`'${reason}`) || code.includes(`\`${reason}`), reason);
  for (const reason of RETIRED_REASONS) assert.ok(!code.includes(`'${reason}'`), reason);
});

test('план: новые из поиска, перепроверка отсеянных, бэкфилл seen', async () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  const recent = '2026-10-15T10:00:00.000Z';
  const row = (id, extra) => ({
    id,
    external_id: String(id),
    dup_key: `hh:5:${id}`,
    title: 'Frontend React',
    company: 'Компания',
    company_id: '5',
    experience: 'between3And6',
    responses: 10,
    createdAt: recent,
    ...extra,
  });
  const rows = [
    row(1, { status: 'seen', dup_key: 'hh:5:frontend' }),
    row(2, { status: 'applied', dup_key: 'hh:5:react' }),
    row(3, { status: 'rejected', reasons: 'без опыта', title: 'Fullstack Developer', experience: 'noExperience' }),
    row(4, { status: 'rejected', reasons: 'нет React и Vue', title: 'Frontend-разработчик' }),
    row(5, { status: 'rejected', reasons: 'AI не на JS/TS', title: 'AI Engineer' }),
    row(6, { status: 'rejected', reasons: 'чужой стек', title: 'Senior Java Developer' }),
    row(7, { status: 'rejected', reasons: 'без опыта', experience: 'noExperience', createdAt: '2026-08-01T00:00:00.000Z' }),
  ];
  const record = (id, title, dup = `hh:5:r${id}`) => ({
    external_id: String(id),
    dup_key: dup,
    title,
    company: 'Компания',
    company_id: '5',
    experience: 'between3And6',
    responses: 4000,
    status: 'new',
  });
  const records = [
    record(1, 'Frontend React', 'hh:5:frontend'), // живая из бэкфилла — придёт новой
    record(2, 'Frontend React', 'hh:5:react'), // уже в базе
    record(30, 'Frontend React', 'hh:5:react'), // дубль строки 2
    record(40, 'Senior React Developer'),
    record(50, 'PHP developer'),
  ];
  const plan = await planSweep({
    rows,
    records,
    settingsRows: settingRows({ 'profile.preset': 'frontend', 'filter.rules_off': ['no_exp'], 'filter.max_responses': 0 }),
    blacklistRows: [],
    days: 30,
    now,
  });
  assert.deepEqual(
    plan.insert.map((r) => [r.external_id, r.status]),
    [
      ['1', 'new'],
      ['40', 'new'],
      ['50', 'rejected'],
    ],
  );
  assert.deepEqual(
    plan.requeue.map((r) => r.id),
    [3, 5],
  );
  assert.deepEqual(plan.seen, [1]);
  assert.equal(plan.seenBack, 1);
  assert.equal(plan.queue, 4);
});
