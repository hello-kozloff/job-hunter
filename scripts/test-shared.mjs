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
  ['n8n/shared/settings.js', 'n8n/shared/resumes.js'],
  'SETTINGS, loadSettings, validSetting, resumeList, resumeById, activeResumes, nextResumeId, resumeData, resumeSettings, resumeRows',
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

test('r2 overlays its own fields, falls back to key defaults, leaves the base alone', () => {
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
  assert.equal(s['profile.resume'], 'main text');
  assert.equal(d['filter.max_responses'], s['filter.max_responses']);
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
