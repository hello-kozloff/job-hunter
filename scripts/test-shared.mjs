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
  ],
  'SETTINGS, RESUME_FIELDS, loadSettings, validSetting, resumeList, resumeById, activeResumes, nextResumeId, resumeData, resumeSettings, resumeRows, resumeSearchable, searchQueries, inheritPerson, resumeFromDraft, draftFromAnswer',
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
