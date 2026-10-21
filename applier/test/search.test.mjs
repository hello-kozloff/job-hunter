// Подборка hh «по резюме» (21.10.2026): адреса, которые робот согласен открыть, и разбор выдачи. Запуск: cd applier && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_MAX_URLS, cleanSearchUrls, searchResult, searchUrlOk } from '../src/hh/search.mjs';

const HASH = 'ad21daa1ff10d9b4ac0039ed1f395547644163';
const url = (q = `resume=${HASH}&work_format=REMOTE&search_period=1`) => `https://hh.ru/search/vacancy?${q}`;

test('searchUrlOk: только поиск hh с хешем резюме', () => {
  assert.equal(searchUrlOk(url()), true);
  assert.equal(searchUrlOk(url(`work_format=REMOTE&resume=${HASH}&page=2`)), true);
  assert.equal(searchUrlOk(url('text=react')), false, 'без resume — обычный поиск, его W1 читает сам');
  assert.equal(searchUrlOk(url('resume=xyz')), false);
  assert.equal(searchUrlOk(`http://hh.ru/search/vacancy?resume=${HASH}`), false);
  assert.equal(searchUrlOk(`https://hh.ru/applicant/negotiations?resume=${HASH}`), false);
  assert.equal(searchUrlOk(`https://evil.example/search/vacancy?resume=${HASH}`), false);
  assert.equal(searchUrlOk(`https://hh.ru.evil.example/search/vacancy?resume=${HASH}`), false);
  assert.equal(searchUrlOk('не адрес'), false);
  assert.equal(searchUrlOk(undefined), false);
});

test('cleanSearchUrls: список 1–6 адресов, любой чужой — ошибка', () => {
  assert.deepEqual(cleanSearchUrls([url()]), { urls: [url()] });
  assert.match(cleanSearchUrls([]).error, /нужны urls/);
  assert.match(cleanSearchUrls('x').error, /нужны urls/);
  assert.match(cleanSearchUrls(Array(SEARCH_MAX_URLS + 1).fill(url())).error, /не больше/);
  assert.match(cleanSearchUrls([url(), 'https://hh.ru/vacancy/1']).error, /не адрес подборки/);
});

test('searchResult: выдача с применённым резюме → total и вакансии как есть', () => {
  const vacancies = [{ vacancyId: 1, name: 'AI-инженер' }];
  assert.deepEqual(searchResult({ vacancySearchResult: { criteria: { resume: HASH }, totalResults: 49, vacancies } }), {
    total: 49,
    vacancies,
  });
});

test('searchResult: hh отбросил резюме (вся база) или сменилась вёрстка → ошибка, а не выдача', () => {
  const vacancies = [{ vacancyId: 1 }];
  assert.deepEqual(searchResult({ vacancySearchResult: { criteria: { resume: null }, totalResults: 959920, vacancies } }), { error: 'resume' });
  assert.deepEqual(searchResult({ vacancySearchResult: { criteria: {} } }), { error: 'layout' });
  assert.deepEqual(searchResult({}), { error: 'layout' });
  assert.deepEqual(searchResult(null), { error: 'layout' });
});
