// Тесты разбора страниц резюме hh (часть D, E0): хеши, ссылки на правку, пределы полей, что пишет запись.
// Запуск: cd applier && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editLinks, limitsOf, recordWanted, resumeHashes, resumeUrl } from '../src/hh/resume.mjs';

const A = '0123456789abcdef0123456789abcdef012345';
const B = 'fedcba9876543210fedcba9876543210fedcba';

test('resumeHashes: по порядку, без повторов, короткие и чужие пути — мимо', () => {
  const html = `
    <a href="/resume/${A}">Frontend</a> <a href="https://hh.ru/resume/${A}?from=list">ещё раз</a>
    <a href="/resume/${B}">Копия</a> <a href="/resume/123abc">коротко</a> <a href="/vacancy/123">вакансия</a>`;
  assert.deepEqual(resumeHashes(html), [A, B]);
  assert.deepEqual(resumeHashes(''), []);
  assert.equal(resumeUrl(A), `https://hh.ru/resume/${A}`);
});

test('editLinks: только правка этого резюме на hh; действия, просмотр и чужое — мимо', () => {
  const html = `
    <a href="/resume/${A}">просмотр</a>
    <a href="/applicant/resumes/edit/position?resume=${A}&amp;field=title">должность</a>
    <a href="/applicant/resumes/edit/experience?resume=${A}#top">опыт</a>
    <a href="/applicant/resumes/edit/experience?resume=${A}">опыт ещё раз</a>
    <a href="/applicant/resumes/edit/position?resume=${B}">другое резюме</a>
    <a href="/applicant/resumes/touch?resume=${A}">поднять в поиске</a>
    <a href="/applicant/resumes/edit/delete?resume=${A}">удалить</a>
    <a href="/applicant/resumes/edit/visibility?resume=${A}">видимость</a>
    <a href="/resume_converter/${A}.pdf?type=pdf&amp;edit=1">скачать</a>
    <a href="/applicant/resumes/duplicate?resume=${A}&amp;edit=1">копия</a>
    <a href="https://evil.example/edit?resume=${A}">чужой сайт</a>`;
  assert.deepEqual(editLinks(html, A), [
    `https://hh.ru/applicant/resumes/edit/position?resume=${A}&field=title`,
    `https://hh.ru/applicant/resumes/edit/experience?resume=${A}`,
  ]);
  assert.deepEqual(editLinks(html, 'nope'), []);
});

test('limitsOf: числа под maxLength / minCount / max_length — с путём; minute и строки — мимо', () => {
  const state = {
    resume: {
      title: { maxLength: 100, value: 'Frontend' },
      skills: { conditions: { max_length: 3000, minCount: 1 } },
      keySkills: [{ maxItems: 30 }, { maxItems: 31 }],
      minutes: 5,
      maximum: { count: 2 },
      maxText: 'много',
    },
  };
  assert.deepEqual(limitsOf(state), {
    'resume.title.maxLength': 100,
    'resume.skills.conditions.max_length': 3000,
    'resume.skills.conditions.minCount': 1,
    'resume.keySkills[0].maxItems': 30,
    'resume.keySkills[1].maxItems': 31,
  });
  assert.equal(Object.keys(limitsOf(state, 2)).length, 2);
  assert.deepEqual(limitsOf(null), {});
});

test('recordWanted: отклик и чаты — как раньше; для резюме — любой не-GET к hh и GET с resume', () => {
  assert.ok(recordWanted('POST', 'https://hh.ru/applicant/vacancy_response/popup'));
  assert.ok(recordWanted('GET', 'https://chatik.hh.ru/chatik/api/chats'));
  assert.ok(recordWanted('POST', 'https://hh.ru/shards/resume/edit/save?resume=x'));
  assert.ok(recordWanted('PUT', 'https://api.hh.ru/resumes/x'));
  assert.ok(recordWanted('GET', 'https://hh.ru/shards/resume/edit/info?resume=x'));
  assert.ok(!recordWanted('GET', 'https://hh.ru/shards/vacancy/search'));
  assert.ok(!recordWanted('POST', 'https://example.com/resume/save'));
  assert.ok(!recordWanted('POST', 'https://hh.ru.evil.com/resume'));
});
