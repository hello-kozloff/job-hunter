// W1 (запуск — node --test scripts/test-w1.mjs): каким резюме вакансия; догон после простоя; очередь страниц.
// Пока резюме больше одного, W1 подписывает резюме все вакансии (у основного resume_id пустой); с одним — как раньше.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runNode } from './lib/sandbox.mjs';

const rows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));
const duo = (r2 = {}) =>
  rows({
    resumes: [
      { id: 'r1', name: 'Frontend', active: true, hh: null },
      { id: 'r2', name: 'Дизайнер', active: true, hh: null, ...r2 },
    ],
    'resume.r2': { resume: 'x', in_name: ['дизайнер'] },
  });
const plan = (settings) => runNode('n8n/w1-collector/plan.js', { nodes: { Settings: settings } });

test('Plan: одно резюме — без названия резюме, как раньше', async () => {
  const items = await plan(rows({}));
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.resumeId, '');
    assert.equal(item.resumeName, '');
  }
});

test('Plan: два резюме — название у запросов обоих, у основного resumeId пустой', async () => {
  const items = await plan(duo());
  const main = items.filter((i) => !i.resumeId);
  const second = items.filter((i) => i.resumeId === 'r2');
  assert.ok(main.length && second.length);
  assert.ok(main.every((i) => i.resumeName === 'Frontend'));
  assert.ok(second.every((i) => i.resumeName === 'Дизайнер'));
});

test('Plan: второе резюме выключено — основное всё равно подписано (резюме больше одного)', async () => {
  const items = await plan(duo({ active: false }));
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.resumeId === '' && i.resumeName === 'Frontend'));
});

// Страница поиска hh: InitialState — JSON с HTML-сущностями
const page = (vacancies) => {
  const state = JSON.stringify({ vacancySearchResult: { vacancies, totalResults: vacancies.length } }).replace(/"/g, '&quot;');
  return { statusCode: 200, data: `<html><template id="HH-Lux-InitialState">${state}</template></html>` };
};
const VACANCY = {
  vacancyId: 138000001,
  name: 'Frontend-разработчик',
  company: { id: 5, visibleName: 'Компания' },
  area: { name: 'Москва' },
  publicationTime: { $: '2026-10-17T10:00:00+0300' },
};
const parse = (planItem) =>
  runNode('n8n/w1-collector/parse-search.js', { input: [page([VACANCY])], nodes: { Plan: [planItem] } }).then(([out]) => out.vacancies[0]);

test('Parse search: колонки резюме — только когда они есть', async () => {
  const one = await parse({ label: 'удалёнка', page: 0, resumeId: '', resumeName: '' });
  assert.ok(!('resume_id' in one) && !('resume_name' in one), 'одно резюме: колонки не пишутся, строка как раньше');
  const main = await parse({ label: 'Frontend: удалёнка', page: 0, resumeId: '', resumeName: 'Frontend' });
  assert.ok(!('resume_id' in main), 'основное: resume_id пустой');
  assert.equal(main.resume_name, 'Frontend');
  const second = await parse({ label: 'Дизайнер: удалёнка', page: 0, resumeId: 'r2', resumeName: 'Дизайнер' });
  assert.deepEqual(Object.keys(second).slice(-2), ['resume_id', 'resume_name'], 'порядок колонок прежний');
  assert.equal(second.resume_id, 'r2');
  assert.equal(second.resume_name, 'Дизайнер');
});

// Догон после простоя (19.10.2026): «Last ok» — последний успешный сбор
const HOUR = 3600 * 1000;
const lastOk = (hoursAgo) => ({ id: 1, status: 'ok', started_at: new Date(Date.now() - hoursAgo * HOUR).toISOString() });
const param = (url, name) => new URL(url).searchParams.get(name);

test('Plan: без успешных сборов и после короткого перерыва — сутки, одна страница, как раньше', async () => {
  for (const nodes of [{ Settings: rows({}) }, { Settings: rows({}), 'Last ok': {} }, { Settings: rows({}), 'Last ok': lastOk(2) }]) {
    const items = await runNode('n8n/w1-collector/plan.js', { nodes });
    assert.equal(items.length, 1);
    assert.equal(param(items[0].url, 'search_period'), '1');
    assert.equal(param(items[0].url, 'page'), '0');
    assert.equal(items[0].catchup, false);
  }
});

test('Plan: простой 40 ч — догон за 3 дня, 2 страницы', async () => {
  const items = await runNode('n8n/w1-collector/plan.js', { nodes: { Settings: rows({}), 'Last ok': lastOk(40) } });
  assert.deepEqual(
    items.map((i) => [param(i.url, 'search_period'), param(i.url, 'page')]),
    [
      ['3', '0'],
      ['3', '1'],
    ],
  );
  assert.ok(items.every((i) => i.catchup && i.period === 3 && i.pages === 2 && i.gapHours === 40));
});

test('Plan: простой 10 дней — 7 дней (больше hh не знает), 3 страницы', async () => {
  const items = await runNode('n8n/w1-collector/plan.js', { nodes: { Settings: rows({}), 'Last ok': lastOk(240) } });
  assert.deepEqual(items.map((i) => param(i.url, 'page')), ['0', '1', '2']);
  assert.ok(items.every((i) => param(i.url, 'search_period') === '7'));
});

test('Plan: период 7 в настройках — обычный сбор одной страницей, догон после суток — 3 страницы', async () => {
  const s = rows({ 'search.period': 7 });
  const usual = await runNode('n8n/w1-collector/plan.js', { nodes: { Settings: s, 'Last ok': lastOk(1) } });
  assert.equal(usual.length, 1);
  assert.equal(param(usual[0].url, 'search_period'), '7');
  const after = await runNode('n8n/w1-collector/plan.js', { nodes: { Settings: s, 'Last ok': lastOk(30) } });
  assert.equal(after.length, 3);
});

// Очередь страниц: строки этого сбора — все, хвост прошлых — не больше 25, свежие публикации первыми
const pendingRow = (id, day, extra = {}) => ({
  id,
  external_id: String(1000 + id),
  status: 'new',
  url: `https://hh.ru/vacancy/${1000 + id}`,
  published_at: `2026-10-${String(day).padStart(2, '0')}T10:00:00+0300`,
  ...extra,
});

test('Candidates: свежие без потолка, хвост — 25 самых свежих', async () => {
  const fresh = Array.from({ length: 30 }, (_, i) => pendingRow(100 + i, 19));
  const backlog = Array.from({ length: 40 }, (_, i) => pendingRow(i + 1, 1 + (i % 18)));
  const out = await runNode('n8n/w1-collector/candidates.js', {
    input: [...backlog, ...fresh],
    nodes: { 'Filter search': fresh.map((r) => ({ external_id: r.external_id, status: 'new' })) },
  });
  assert.equal(out.length, 30 + 25);
  assert.deepEqual(
    out.slice(0, 30).map((r) => r.id),
    fresh.map((r) => r.id),
  );
  const tail = out.slice(30);
  const days = tail.map((r) => Date.parse(r.published_at));
  assert.deepEqual(days, [...days].sort((a, b) => b - a), 'хвост — свежие первыми');
  assert.ok(tail.every((r) => r.id <= 40));
});

test('Candidates: в выдаче нового нет — только хвост; пустая таблица — ничего', async () => {
  const out = await runNode('n8n/w1-collector/candidates.js', { input: [pendingRow(1, 10), pendingRow(2, 12)], nodes: {} });
  assert.deepEqual(
    out.map((r) => r.id),
    [2, 1],
  );
  assert.deepEqual(await runNode('n8n/w1-collector/candidates.js', { input: [{}], nodes: {} }), []);
});

// Сообщение о сборе: hh нашёл — по странице 0, строка очереди, строка догона
const scoreJob = (nodes) =>
  runNode('n8n/w1-collector/score-job.js', {
    nodes: { Settings: rows({}), 'Start run': { id: 7 }, ...nodes },
    env: { USER_TZ: 'Asia/Bangkok' },
  }).then(([out]) => out);
const planItem = (page, extra = {}) => ({ page, label: 'удалёнка', startedAt: Date.now(), period: 1, catchup: false, gapHours: 0, pages: 1, ...extra });

test('Score job: две страницы догона — «hh нашёл» не удваивается, есть строка догона', async () => {
  const out = await scoreJob({
    Plan: [planItem(0, { period: 3, catchup: true, gapHours: 40, pages: 2 }), planItem(1, { period: 3, catchup: true, gapHours: 40, pages: 2 })],
    'Parse search': {
      ok: true,
      vacancies: [],
      requests: [
        { label: 'удалёнка', page: 0, status: 200, total: 150, count: 100 },
        { label: 'удалёнка', page: 1, status: 200, total: 150, count: 50 },
      ],
    },
  });
  assert.equal(out.run.found, 150);
  assert.match(out.report, /⏩ Догоняю: успешного сбора не было 40 ч — ищу за 3 дня, 2 страницы/);
  assert.match(out.report, /hh нашёл за 3 дня 150/);
});

test('Score job: хвост очереди — отдельной строкой, «новых» — только из этого сбора', async () => {
  const fresh = [
    { external_id: '1', status: 'new' },
    { external_id: '2', status: 'rejected', reasons: 'стоп-слово', title: 'PHP', url: 'https://hh.ru/vacancy/2' },
  ];
  const out = await scoreJob({
    Plan: [planItem(0)],
    'Parse search': { ok: true, vacancies: [{}, {}], requests: [{ label: 'удалёнка', page: 0, status: 200, total: 2, count: 2 }] },
    'Filter search': fresh,
    'Pending new': [{ id: 1, external_id: '1' }, { id: 10, external_id: '10' }, { id: 11, external_id: '11' }, { id: 12, external_id: '12' }],
    'Parse vacancy': [
      { external_id: '1', status: 'detailed' },
      { external_id: '10', status: 'detailed' },
      { external_id: '11', status: 'rejected', reasons: 'в архиве' },
    ],
  });
  assert.match(out.report, /новых 2: на оценку 1, отсеяно 1/);
  assert.match(out.report, /📥 Из очереди: страниц 2 — на оценку 1, отсеяно 1 · ждут ещё 1/);
  assert.deepEqual(out.run, { found: 2, uniq: 2, fresh: 2, rejected: 2, scoring: 2, pages: 3 });
});

// Собранный W1: порядок веток «OK?» (n8n, execution order v1: сверху вниз, каждая целиком) и очередь вместо «Is candidate»
test('сборка W1: сигнал стражу → вставка → очередь страниц → итог; «Last ok» перед «Plan»', () => {
  const wf = JSON.parse(readFileSync(fileURLToPath(new URL('../n8n/workflows/w1-collector.json', import.meta.url)), 'utf8'));
  const byName = new Map(wf.nodes.map((n) => [n.name, n]));
  const children = (name, output = 0) => (wf.connections[name]?.main?.[output] ?? []).map((c) => c.node);
  const order = children('OK?').sort((a, b) => byName.get(a).position[1] - byName.get(b).position[1] || byName.get(a).position[0] - byName.get(b).position[0]);
  assert.deepEqual(order, ['HC ping?', 'Split vacancies', 'Pending new', 'Score job']);
  assert.deepEqual(children('Settings'), ['Last ok']);
  assert.deepEqual(children('Last ok'), ['Plan']);
  assert.deepEqual(children('Pending new'), ['Candidates']);
  assert.deepEqual(children('Candidates'), ['Vacancy page']);
  assert.deepEqual(children('Insert'), []);
  assert.ok(!byName.has('Is candidate'));
  assert.deepEqual(children('Score job').sort((a, b) => byName.get(a).position[1] - byName.get(b).position[1]), ['Finish run', 'Score']);
});
