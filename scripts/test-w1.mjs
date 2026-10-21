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
  runNode('n8n/w1-collector/parse-search.js', { nodes: { Plan: [planItem], 'Search hh': [page([VACANCY])] } }).then(([out]) => out.vacancies[0]);

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

// Подборка hh «по резюме» (21.10.2026): адреса для робота — у резюме с хешем hh и удалёнкой
const HASH = 'ad21daa1ff10d9b4ac0039ed1f395547644163';
const HASH2 = 'fa4e00000000000000000000000000000000001';
const linked = (extra = {}) => rows({ resumes: [{ id: 'r1', name: 'Fullstack AI Engineer', active: true, hh: { hash: HASH, title: 'Fullstack AI Engineer' } }], ...extra });

test('Plan: подборка по резюме — только у резюме с хешем hh и удалёнкой; адрес как у поиска', async () => {
  assert.deepEqual((await plan(rows({})))[0].robot, [], 'без связи с hh подборки нет');
  const [first, ...rest] = await plan(linked());
  assert.equal(first.robot.length, 1);
  assert.ok(rest.every((i) => !('robot' in i)), 'список — только у первого item');
  const q = first.robot[0];
  assert.deepEqual([q.label, q.page, q.resumeId, q.resumeName], ['по резюме hh', 0, '', '']);
  const u = new URL(q.url);
  assert.equal(`${u.origin}${u.pathname}`, 'https://hh.ru/search/vacancy');
  assert.deepEqual(
    ['resume', 'work_format', 'education', 'search_period', 'order_by', 'page'].map((k) => u.searchParams.get(k)),
    [HASH, 'REMOTE', 'not_required_or_not_specified', '1', 'publication_time', '0'],
  );
  assert.ok(!u.searchParams.has('text') && !u.searchParams.has('professional_role'), 'слова и роли подбирает hh');
  const office = await plan(linked({ 'search.formats': ['ON_SITE'], 'search.area': { id: 2, name: 'Санкт-Петербург' } }));
  assert.deepEqual(office[0].robot, [], 'без удалёнки подборку не читаем');
});

test('Plan: догон — те же страницы и у подборки, не больше 6 адресов, сначала страница 0 каждого резюме', async () => {
  const items = await runNode('n8n/w1-collector/plan.js', { nodes: { Settings: linked(), 'Last ok': lastOk(240) } });
  assert.deepEqual(items[0].robot.map((q) => [q.page, param(q.url, 'search_period')]), [[0, '7'], [1, '7'], [2, '7']]);
  const three = rows({
    resumes: [
      { id: 'r1', name: 'A', active: true, hh: { hash: HASH, title: 'A' } },
      { id: 'r2', name: 'B', active: true, hh: { hash: HASH2, title: 'B' } },
      { id: 'r3', name: 'C', active: true, hh: { hash: `${HASH2.slice(0, -1)}2`, title: 'C' } },
    ],
    'resume.r2': { resume: 'x', in_name: ['b'] },
    'resume.r3': { resume: 'x', in_name: ['c'] },
  });
  const many = await runNode('n8n/w1-collector/plan.js', { nodes: { Settings: three, 'Last ok': lastOk(240) } });
  assert.deepEqual(many[0].robot.map((q) => [q.resumeName, q.page]), [['A', 0], ['B', 0], ['C', 0], ['A', 1], ['B', 1], ['C', 1]]);
  assert.equal(many[0].robot[1].label, 'B: по резюме hh');
});

// Ответ робота «Search resume» (applier POST /search): полный ответ HTTP Request
const robotOk = (results) => ({ statusCode: 200, body: { ok: true, results } });
const ROBOT_PLAN = [{ url: 'https://hh.ru/search/vacancy?resume=x&page=0', label: 'по резюме hh', page: 0, resumeId: '', resumeName: '' }];
const vacancy = (id, extra = {}) => ({ ...VACANCY, vacancyId: id, ...extra });
const parseAll = (robot, hh = [VACANCY]) =>
  runNode('n8n/w1-collector/parse-search.js', {
    nodes: { Plan: [{ label: 'удалёнка', page: 0, robot: ROBOT_PLAN }], 'Search hh': [page(hh)], ...(robot && { 'Search resume': robot }) },
  }).then(([out]) => out);

test('Parse search: подборка — новые с via = resume, найденные обычным поиском остаются своими', async () => {
  const out = await parseAll(
    robotOk([
      {
        url: ROBOT_PLAN[0].url,
        ok: true,
        total: 47,
        vacancies: [
          vacancy(VACANCY.vacancyId), // тот же id — уже из обычного поиска
          vacancy(138000002, { area: { name: 'Минск' } }), // та же компания и название — копия в другом регионе
          vacancy(138000003, { name: 'AI-инженер' }),
          { vacancyId: 0 }, // битая — пропускаем, сбор не роняем
        ],
      },
    ]),
  );
  assert.equal(out.ok, true);
  assert.deepEqual(out.vacancies.map((v) => [v.external_id, v.via ?? '', v.areas]), [
    ['138000001', '', 'Москва, Минск'],
    ['138000003', 'resume', 'Москва'],
  ]);
  assert.deepEqual(out.requests.at(-1), { label: 'по резюме hh', page: 0, status: 200, total: 47, count: 3, robot: true });
});

test('Parse search: робот занят, выключен, капча — сбор идёт, причина в requests', async () => {
  const status = async (robot) => (await parseAll(robot)).requests.filter((r) => r.robot).map((r) => r.status);
  assert.deepEqual(await status({ statusCode: 409, body: { busy: true } }), ['робот занят']);
  assert.deepEqual(await status({ statusCode: 423, body: { blocked: { kind: 'captcha' } } }), ['робот на паузе']);
  assert.deepEqual(await status({ error: { message: 'ECONNREFUSED' } }), ['робот не отвечает']);
  assert.deepEqual(await status(robotOk([{ url: ROBOT_PLAN[0].url, ok: false, error: 'captcha' }])), ['капча — робот на паузе']);
  assert.deepEqual(await status(robotOk([])), ['нет ответа']);
  const out = await parseAll({ statusCode: 409, body: {} });
  assert.deepEqual([out.ok, out.vacancies.length], [true, 1]);
  assert.deepEqual((await parseAll(null)).requests.filter((r) => r.robot), [], 'узел не запускался — подборки нет');
});

test('Parse search: обычный поиск «найдено 0», подборка что-то нашла — не поломка', async () => {
  const out = await parseAll(robotOk([{ url: ROBOT_PLAN[0].url, ok: true, total: 1, vacancies: [vacancy(138000009)] }]), []);
  assert.deepEqual([out.ok, out.vacancies.map((v) => v.via)], [true, ['resume']]);
});

test('Score job: подборка — отдельной строкой, «hh нашёл» и found — только обычный поиск; ссылка на подборку', async () => {
  const out = await scoreJob({
    Plan: [planItem(0, { robot: ROBOT_PLAN })],
    'Parse search': {
      ok: true,
      vacancies: [{}, {}],
      requests: [
        { label: 'удалёнка', page: 0, status: 200, total: 40, count: 40 },
        { label: 'по резюме hh', page: 0, status: 200, total: 47, count: 47, robot: true },
      ],
    },
    'Filter search': [
      { external_id: '1', status: 'new', via: 'resume' },
      { external_id: '2', status: 'new' },
    ],
  });
  assert.match(out.report, /1 запрос к hh: поиск, стр\. 1 → 200/);
  assert.match(out.report, /hh нашёл за сутки 40/);
  assert.match(out.report, /📄 Подборка hh по резюме: hh нашёл 47, сверх обычного поиска новых 1/);
  assert.match(out.report, /🔗 <a href="https:\/\/hh\.ru\/search\/vacancy\?resume=x&amp;page=0">Открыть подборку по резюме на hh<\/a>/);
  assert.equal(out.run.found, 40);
  const busy = await scoreJob({
    Plan: [planItem(0, { robot: ROBOT_PLAN })],
    'Parse search': { ok: true, vacancies: [], requests: [{ label: 'удалёнка', page: 0, status: 200, total: 0, count: 0 }, { label: 'по резюме hh', page: 0, status: 'робот занят', total: null, count: 0, robot: true }] },
  });
  assert.match(busy.report, /📄 Подборка hh по резюме: пропуск — робот занят/);
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
  // Подборка по резюме: робот — между «Search hh» и «Parse search», только если «Plan» дал адреса; сбой не роняет
  assert.deepEqual(children('Search hh'), ['Robot?']);
  assert.deepEqual([children('Robot?', 0), children('Robot?', 1)], [['Search resume'], ['Parse search']]);
  assert.deepEqual(children('Search resume'), ['Parse search']);
  const robot = byName.get('Search resume');
  assert.deepEqual([robot.executeOnce, robot.onError, robot.parameters.url], [true, 'continueRegularOutput', '=http://applier:3000/search']);
});

// Правила 19.10.2026 (решения пользователя): AI на любом языке, junior — целым словом, «только из РФ» без отрицаний
const FRONTEND = rows({ 'profile.preset': 'frontend' });
const filter = (titles) =>
  runNode('n8n/w1-collector/filter-search.js', {
    nodes: {
      Settings: FRONTEND,
      'Is new': titles.map((title, i) => ({ external_id: String(i + 1), title, company: 'Компания', company_id: '5', experience: 'between3And6', responses: 10 })),
      Blacklist: [{}],
    },
  });

test('Filter search: AI на Python проходит, Python без AI и AI на Java/Go/.NET режутся', async () => {
  const out = await filter([
    'AI Engineer (Python)',
    'Python AI Automation Engineer',
    'Backend-разработчик (Python, ИИ-платформа)',
    'Senior Python Developer (Django / DRF)',
    'Senior Java Engineer with AI',
    'Golang AI Developer',
    'Senior .NET Developer (LLM / RAG)',
    'Fullstack-разработчик (Python / React)',
  ]);
  assert.deepEqual(
    out.map((r) => [r.title, r.status]),
    [
      ['AI Engineer (Python)', 'new'],
      ['Python AI Automation Engineer', 'new'],
      ['Backend-разработчик (Python, ИИ-платформа)', 'new'],
      ['Senior Python Developer (Django / DRF)', 'rejected'],
      ['Senior Java Engineer with AI', 'rejected'],
      ['Golang AI Developer', 'rejected'],
      ['Senior .NET Developer (LLM / RAG)', 'rejected'],
      ['Fullstack-разработчик (Python / React)', 'new'],
    ],
  );
});

test('Filter search: junior — Intern и Internship, но не Internal и International', async () => {
  const out = await filter([
    'Frontend Developer (Internal Tools)',
    'Frontend Developer, International team',
    'Intern Front-end Developer',
    'Frontend Internship',
    'Frontend Interns',
  ]);
  assert.deepEqual(
    out.map((r) => r.status),
    ['new', 'new', 'rejected', 'rejected', 'rejected'],
  );
});

// Страница вакансии: InitialState — JSON с HTML-сущностями
const vacancyPage = (id, description, keySkills = []) => {
  const state = JSON.stringify({ vacancyView: { vacancyFull: { vacancy: { vacancyId: id, description, keySkills } } } }).replace(/"/g, '&quot;');
  return { statusCode: 200, data: `<html><template id="HH-Lux-InitialState">${state}</template></html>` };
};
const parseVacancy = async (cases) => {
  const rowsIn = cases.map(([title], i) => ({ id: i + 1, external_id: String(1000 + i), title, key_skills: '', status: 'new' }));
  return runNode('n8n/w1-collector/parse-vacancy.js', {
    input: cases.map(([, description, skills], i) => vacancyPage(1000 + i, description, skills)),
    nodes: { Candidates: rowsIn, Settings: FRONTEND },
  });
};

test('Parse vacancy: AI без JS проходит, не-AI без React и Vue отсеян', async () => {
  const out = await parseVacancy([
    ['AI Engineer', '<p>Python, FastAPI, LangChain, агенты на LLM.</p>'],
    ['Разработчик AI-агентов', '<p>Go и Python, RAG.</p>'],
    ['Frontend-разработчик', '<p>Svelte и TypeScript.</p>'],
    ['Frontend-разработчик', '<p>React, TypeScript.</p>'],
  ]);
  assert.deepEqual(
    out.map((r) => [r.status, r.reasons]),
    [
      ['detailed', ''],
      ['detailed', ''],
      ['rejected', 'нет React и Vue'],
      ['detailed', ''],
    ],
  );
});

test('Parse vacancy: «только из РФ» — без отрицаний', async () => {
  const out = await parseVacancy([
    ['Frontend React', '<p>React. Работа только из РФ.</p>'],
    ['Frontend React', '<p>React. Нельзя находиться в РФ во время работы.</p>'],
    ['Frontend React', '<p>React. Не обязательно быть налоговым резидентом РФ.</p>'],
    ['Frontend React', '<p>React. Мы делаем не только сайты, работа только из России.</p>'],
    ['Frontend React', '<p>React. Мы не нанимаем подрядчиков. Требуется находиться в России.</p>'],
  ]);
  assert.deepEqual(
    out.map((r) => r.status),
    ['rejected', 'detailed', 'detailed', 'rejected', 'rejected'],
  );
  assert.match(out[0].reasons, /^только из РФ: «только из РФ»/);
});
