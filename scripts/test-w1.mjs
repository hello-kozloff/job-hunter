// W1: каким резюме вакансия (запуск — node --test scripts/test-w1.mjs).
// Пока резюме больше одного, W1 подписывает резюме все вакансии (у основного resume_id пустой); с одним — как раньше.
import test from 'node:test';
import assert from 'node:assert/strict';
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
