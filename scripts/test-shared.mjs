// Тесты общего кода n8n/shared (запуск: node --test scripts/test-shared.mjs).
// Общий код — не модули, а текст, который сборщик вставляет в Code-ноды, поэтому грузим его как текст.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const load = (files, exports) =>
  new Function(`${files.map((f) => readFileSync(`${root}${f}`, 'utf8')).join('\n')}\nreturn { ${exports} };`)();

const lib = load(
  [
    'n8n/shared/time.js',
    'n8n/shared/card.js',
    'n8n/shared/settings.js',
    'n8n/shared/hh-roles.js',
    'n8n/shared/search.js',
    'n8n/shared/resumes.js',
    'n8n/shared/profile.js',
    'n8n/shared/hh-resume.js',
  ],
  'SETTINGS, RESUME_FIELDS, loadSettings, validSetting, resumeList, resumeById, activeResumes, nextResumeId, resumeData, resumeSettings, resumeRows, resumeSearchable, searchQueries, inheritPerson, resumeFromDraft, draftFromAnswer, hhDate, hhDuration, hhResumeText, applyHhFacts, hhOutcome, hhWhy',
);
const rows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));

test('no stored resumes: one main resume, settings unchanged', () => {
  const s = lib.loadSettings(rows({ 'profile.resume': 'text', 'profile.facts': { position: 'Frontend' } }));
  assert.deepEqual(lib.resumeList(s), [{ id: 'r1', name: 'Frontend', active: true, hh: null }]);
  assert.equal(lib.resumeSettings(s, 'r1'), s);
  assert.equal(lib.resumeSettings(s, ''), s);
  assert.equal(lib.resumeSettings(s, 'r2'), s);
  assert.equal(lib.nextResumeId(s), 'r2');
});

test('main resume takes hh link from cv markup', () => {
  const hh = { hash: 'a'.repeat(32), title: 'Frontend' };
  const cv = { v: 1, places: [], resumes: [{ id: 'r1', hh, template: '', title: '', about: '', keySkills: [] }] };
  const s = lib.loadSettings(rows({ cv }));
  assert.deepEqual(lib.resumeList(s)[0].hh, hh);
});

test('main resume hh link follows the cv markup even when the list is saved', () => {
  const hh = { hash: 'b'.repeat(32), title: 'Frontend' };
  const cv = { v: 1, places: [], resumes: [{ id: 'r1', hh, template: '', title: '', about: '', keySkills: [] }] };
  const s = lib.loadSettings(
    rows({ cv, resumes: [{ id: 'r1', name: 'A', active: true, hh: { hash: 'old', title: 'old' } }, { id: 'r2', name: 'B', active: true, hh: null }] }),
  );
  assert.deepEqual(lib.resumeList(s)[0].hh, hh);
  assert.equal(lib.resumeList(s)[1].hh, null);
  const s2 = lib.loadSettings(rows({ resumes: [{ id: 'r1', name: 'A', active: true, hh: { hash: 'kept', title: 't' } }] }));
  assert.deepEqual(lib.resumeList(s2)[0].hh, { hash: 'kept', title: 't' }, 'no cv markup: the saved link stays');
});

test('main resume hh link: same hash — the saved (fresher) title, another hash — the cv markup', () => {
  const cv = (hash, title) => ({ v: 1, places: [], resumes: [{ id: 'r1', hh: { hash, title }, template: '', title: '', about: '', keySkills: [] }] });
  const saved = (hh) => rows({ resumes: [{ id: 'r1', name: 'A', active: true, hh }, { id: 'r2', name: 'B', active: true, hh: null }] });
  const same = lib.loadSettings([...saved({ hash: 'h1', title: 'Новое название' }), ...rows({ cv: cv('h1', 'Старое название') })]);
  assert.deepEqual(lib.resumeList(same)[0].hh, { hash: 'h1', title: 'Новое название' });
  const relinked = lib.loadSettings([...saved({ hash: 'h1', title: 'Старое' }), ...rows({ cv: cv('h2', 'Другое резюме') })]);
  assert.deepEqual(lib.resumeList(relinked)[0].hh, { hash: 'h2', title: 'Другое резюме' });
  const noCv = lib.loadSettings(saved({ hash: 'h1', title: 'Из списка' }));
  assert.deepEqual(lib.resumeList(noCv)[0].hh, { hash: 'h1', title: 'Из списка' });
});

test('r2 overlays its own fields, falls back to neutral values, leaves the base alone', () => {
  const s = lib.loadSettings(
    rows({
      'profile.resume': 'main text',
      'search.roles': ['96'],
      resumes: [
        { id: 'r1', name: 'Main', active: true, hh: null },
        { id: 'r2', name: 'Designer', active: true, hh: null },
      ],
      'resume.r2': { resume: 'designer text', roles: ['12'], in_name: ['figma'] },
    }),
  );
  const d = lib.resumeSettings(s, 'r2');
  assert.notEqual(d, s);
  assert.equal(d['profile.resume'], 'designer text');
  assert.deepEqual(d['search.roles'], ['12']);
  assert.deepEqual(d['search.in_name'], ['figma']);
  assert.equal(d['profile.extra'], '');
  assert.deepEqual(d['llm.rules'], {});
  // not the owner's frontend defaults
  assert.equal(d['profile.preset'], 'generic');
  assert.deepEqual(d['filter.stop_words'], []);
  assert.deepEqual(d['llm.cases'], []);
  assert.deepEqual(d['search.anywhere'], []);
  assert.equal(s['profile.resume'], 'main text');
  assert.equal(d['filter.max_responses'], s['filter.max_responses']);
});

test('shared settings stay shared in the overlay', () => {
  const s = lib.loadSettings(
    rows({
      'profile.signature': 'Ivan',
      'profile.contact': 'tg',
      'llm.provider': 'claude',
      resumes: [{ id: 'r1', name: 'A', active: true, hh: null }, { id: 'r2', name: 'B', active: true, hh: null }],
      'resume.r2': { resume: 'x' },
    }),
  );
  const d = lib.resumeSettings(s, 'r2');
  assert.equal(d['profile.signature'], 'Ivan');
  assert.equal(d['profile.contact'], 'tg');
  assert.equal(d['llm.provider'], 'claude');
});

test('resume without search words is not searchable; the main one always is', () => {
  const s = lib.loadSettings(
    rows({
      resumes: [{ id: 'r1', name: 'A', active: true, hh: null }, { id: 'r2', name: 'B', active: true, hh: null }],
      'resume.r2': { resume: 'x', roles: ['34'] },
    }),
  );
  assert.ok(lib.resumeSearchable(lib.resumeSettings(s, 'r1')));
  assert.ok(!lib.resumeSearchable(lib.resumeSettings(s, 'r2')));
  const s2 = lib.loadSettings(
    rows({
      resumes: [{ id: 'r1', name: 'A', active: true, hh: null }, { id: 'r2', name: 'B', active: true, hh: null }],
      'resume.r2': { resume: 'x', in_name: [], anywhere: ['дизайнер'] },
    }),
  );
  assert.ok(lib.resumeSearchable(lib.resumeSettings(s2, 'r2')), 'empty in_name is valid when anywhere has words');
  assert.equal(lib.searchQueries(lib.resumeSettings(s2, 'r2')).length, 1);
});

test('invalid stored values are dropped', () => {
  const s = lib.loadSettings(
    rows({
      resumes: [{ id: 'r2', name: 'No main', active: true, hh: null }],
      'resume.r2': { resume: 'x', unknown: 1 },
      'resume.r3': { roles: ['abc'] },
    }),
  );
  assert.deepEqual(s.resumes, []);
  assert.equal(s['resume.r2'], null);
  assert.equal(s['resume.r3'], null);
});

test('validResumes rules', () => {
  const ok = { id: 'r1', name: 'A', active: true, hh: null };
  const v = (list) => lib.validSetting(lib.SETTINGS.resumes, list);
  assert.ok(v([]));
  assert.ok(v([ok]));
  assert.ok(!v([{ ...ok, id: 'r6' }]));
  assert.ok(!v([ok, ok]));
  assert.ok(!v([{ ...ok, name: ' ' }]));
  assert.ok(!v([{ ...ok, hh: { hash: 1, title: 't' } }]));
  assert.ok(v([{ ...ok, hh: { hash: 'abc', title: 't' } }]));
});

test('activeResumes, nextResumeId when full', () => {
  const list = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id, i) => ({ id, name: id, active: i !== 1, hh: null }));
  const s = lib.loadSettings(rows({ resumes: list }));
  assert.deepEqual(lib.activeResumes(s).map((r) => r.id), ['r1', 'r3', 'r4', 'r5']);
  assert.equal(lib.nextResumeId(s), null);
});

test('resumeData / resumeRows', () => {
  const s = lib.loadSettings(rows({ 'profile.resume': 'main', 'search.roles': ['96'] }));
  const data = lib.resumeData(s);
  assert.equal(data.resume, 'main');
  assert.deepEqual(data.roles, ['96']);
  assert.ok(lib.validSetting(lib.SETTINGS['resume.r2'], data), 'a clone of the main resume is valid');
  assert.deepEqual(lib.resumeRows(s, 'r1', { extra: 'e' }), { 'profile.extra': 'e' });
  assert.deepEqual(lib.resumeRows(s, 'r2', { extra: 'e' }), { 'resume.r2': { extra: 'e' } });
  const s2 = lib.loadSettings(rows({ resumes: [{ id: 'r1', name: 'A', active: true, hh: null }, { id: 'r2', name: 'B', active: true, hh: null }], 'resume.r2': { resume: 'x' } }));
  assert.deepEqual(lib.resumeRows(s2, 'r2', { extra: 'e' }), { 'resume.r2': { resume: 'x', extra: 'e' } });
});

const FACTS = {
  name: 'Ivan Petrov', first_name: 'Ivan', name_gen: 'Ивана', gender: 'm', position: 'Frontend', position_gen: 'фронтендера',
  level: 'senior', years: 5, skills: ['React'], companies: ['Acme'], english: 'B2', city: 'Казань', country: 'Россия',
  country_gen: 'России', citizenship: 'РФ', formats: ['REMOTE'], relocation: false, salary: null, education: 'higher',
  contacts: { telegram: '@ivan', email: '' },
};

test('inheritPerson fills only blank person-level facts', () => {
  const f = lib.inheritPerson(
    { name: '', gender: '', city: 'Минск', position: 'Дизайнер', english: '', contacts: { telegram: '', email: 'a@b.ru' } },
    FACTS,
  );
  assert.equal(f.name, 'Ivan Petrov');
  assert.equal(f.gender, 'm');
  assert.equal(f.city, 'Минск', 'own city is kept');
  assert.equal(f.position, 'Дизайнер', 'profession-level facts are not inherited');
  assert.equal(f.english, 'B2');
  assert.deepEqual(f.contacts, { telegram: '@ivan', email: 'a@b.ru' });
});

test('resumeFromDraft gives valid resume data, without shared settings', () => {
  const draft = {
    facts: FACTS,
    about: ['Дизайнер'],
    search: { roles: ['34'], in_name: ['дизайнер'], anywhere: [], stop_words: ['qa'], area: null },
    rules: { skip: ['другая профессия'], maybe: [], apply: ['figma'], ignore: [] },
    warnings: [],
  };
  const data = lib.resumeFromDraft(draft, { resume: 'Дизайнер. Figma.', tz: 'Europe/Moscow', keep: { extra: 'мои проекты' } });
  assert.equal(data.preset, 'generic');
  assert.equal(data.resume, 'Дизайнер. Figma.');
  assert.equal(data.extra, 'мои проекты');
  assert.deepEqual(data.roles, ['34']);
  assert.deepEqual(data.stop_words, ['qa']);
  assert.deepEqual(data.cases, []);
  for (const shared of ['signature', 'contact', 'tz']) assert.ok(!(shared in data));
  assert.ok(data.rules.skip.length > 1, 'common rules are added');
  assert.ok(lib.validSetting(lib.SETTINGS['resume.r2'], data), 'passes the settings schema');
});

test('all RESUME_FIELDS point to existing settings', () => {
  for (const key of Object.values(lib.RESUME_FIELDS)) assert.ok(lib.SETTINGS[key], key);
});

test('hhDate / hhDuration: даты и стаж по-русски', () => {
  assert.equal(lib.hhDate('2025-08-01'), 'август 2025');
  assert.equal(lib.hhDate('2020-01-15'), 'январь 2020');
  assert.equal(lib.hhDate(''), '');
  assert.equal(lib.hhDate('вчера'), '');
  assert.equal(lib.hhDuration(61), '5 лет 1 месяц');
  assert.equal(lib.hhDuration(12), '1 год');
  assert.equal(lib.hhDuration(26), '2 года 2 месяца');
  assert.equal(lib.hhDuration(11), '11 месяцев');
  assert.equal(lib.hhDuration(0), '');
});

test('hhResumeText: название, стаж, навыки, «Обо мне», места — новые первыми; пустое не пишется', () => {
  const text = lib.hhResumeText({
    title: 'Бухгалтер',
    months: 30,
    keySkills: ['1С', 'НДС'],
    about: 'Опыт в торговле.',
    places: [
      { company: 'Студия', position: 'Бухгалтер', description: 'Первичка.', start: '2023-02-01', end: '' },
      { company: 'Торг', position: '', description: '', start: '', end: '2023-01-01' },
    ],
  });
  assert.equal(
    text,
    'Бухгалтер\n\nОпыт работы — 2 года 6 месяцев\n\nКлючевые навыки\n1С, НДС\n\nОбо мне\nОпыт в торговле.\n\nМеста работы\n\nСтудия — февраль 2023 — по настоящее время\nБухгалтер\nПервичка.\n\nТорг — январь 2023',
  );
  assert.equal(lib.hhResumeText({ title: 'Только название' }), 'Только название');
  const long = lib.hhResumeText({ title: 'Т', about: 'о'.repeat(40000), places: [{ company: 'К', position: 'П', description: '', start: '2020-01-01', end: '' }] });
  assert.equal(long.length, 30000, 'не длиннее поля резюме');
  assert.ok(lib.validSetting(lib.SETTINGS['resume.r2'], { resume: long }));
});

test('applyHhFacts: роли, формат, зарплата и стаж с hh; чужое и пустое не трогает', () => {
  const draft = () => ({ facts: { formats: ['ON_SITE'], salary: null, years: 3 }, search: { roles: ['34'] } });
  const d = lib.applyHhFacts(draft(), { roles: [{ id: '18', text: 'Бухгалтер' }, { id: '99999', text: 'нет такой' }, { id: '96' }, { id: '12' }, { id: '34' }], formats: ['REMOTE', 'HYBRID', 'WHATEVER'], salary: { amount: 90000.6, currency: 'RUR' }, months: 61 });
  assert.deepEqual(d.search.roles, ['18', '96', '12'], 'только известные роли hh, не больше трёх');
  assert.deepEqual(d.facts.formats, ['REMOTE', 'HYBRID']);
  assert.deepEqual(d.facts.salary, { amount: 90001, currency: 'RUR' });
  assert.equal(d.facts.years, 5.1);
  const same = lib.applyHhFacts(draft(), { roles: [], formats: [], salary: null, months: 0 });
  assert.deepEqual(same, draft(), 'ничего не пришло — черновик не меняется');
  const badMoney = lib.applyHhFacts(draft(), { salary: { amount: 1000, currency: 'XXX' } });
  assert.equal(badMoney.facts.salary, null);
  assert.equal(lib.applyHhFacts(draft(), { months: 2000 }).facts.years, 60, 'не больше 60 лет');
  assert.deepEqual(lib.applyHhFacts(draft()), draft());
});

test('hhOutcome / hhWhy: ответ робота → ошибка или тело, причина по-русски', () => {
  assert.deepEqual(lib.hhOutcome({ error: { message: 'x' } }), { error: 'down' });
  assert.deepEqual(lib.hhOutcome(undefined), { error: 'down' });
  assert.deepEqual(lib.hhOutcome({ statusCode: 409 }), { error: 'busy' });
  assert.deepEqual(lib.hhOutcome({ statusCode: 423, body: { blocked: { kind: 'login' } } }), { error: 'blocked:login' });
  assert.deepEqual(lib.hhOutcome({ statusCode: 423, body: null }), { error: 'blocked:' });
  assert.deepEqual(lib.hhOutcome({ statusCode: 502 }), { error: 'http:502' });
  assert.deepEqual(lib.hhOutcome({ statusCode: 200, body: { ok: false, error: 'captcha' } }), { error: 'captcha' });
  assert.deepEqual(lib.hhOutcome({ statusCode: 200, body: { ok: false } }), { error: 'layout' });
  assert.deepEqual(lib.hhOutcome({ statusCode: 200, body: { ok: true, resumes: [] } }), { body: { ok: true, resumes: [] } });
  assert.match(lib.hhWhy('busy'), /откликается/);
  assert.match(lib.hhWhy('captcha'), /Общий экран/);
  assert.match(lib.hhWhy('blocked:captcha'), /робот на паузе \(captcha\)/);
  assert.match(lib.hhWhy('http:502'), /ошибка робота \(http:502\)/);
  assert.match(lib.hhWhy('down'), /робот не отвечает/);
  assert.match(lib.hhWhy('empty'), /почти пустое/);
});
