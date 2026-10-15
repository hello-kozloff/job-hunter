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

// ---------- Чтение резюме (часть D, S2) ----------
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { RESUME_LIMITS, parseResume, pickResume, resumeList } from '../src/hh/resume.mjs';
import { ACTION_URL, GUARD_ALLOW, GUARD_URL } from '../src/hh/selectors.mjs';

const hhResume = {
  _attributes: { hash: A, status: 'modified', updated: 1792071673577 },
  _conditions: {
    title: { parts: [{ string: { maxlength: 100, not_in: ['Другое резюме'] } }] },
    skills: { parts: [{ string: { maxlength: 32768 } }] },
    keySkills: { maxcount: 30, parts: [{ string: { maxlength: 100 } }] },
    experience: { parts: [{ id: {} }, { position: { maxlength: 512 } }, { description: { maxlength: 32768 } }] },
  },
  title: [{ string: 'Frontend-разработчик' }],
  skills: [{ string: 'О себе: React.' }],
  keySkills: [{ string: 'React' }, { string: ' TypeScript ' }, { string: '' }],
  accessType: [{ string: 'clients' }],
  experience: [
    { id: 2092614619, companyName: 'Руб Икс', position: 'Senior Frontend Developer', description: 'Карты.', startDate: '2025-08-01', endDate: '2026-09-01' },
    { id: 'x', companyName: 'WillSkill', position: 'Middle', description: '', startDate: '2022-12-01', endDate: null },
  ],
};

test('parseResume: поля hh [{ string }] → строки, места, пределы из _conditions', () => {
  const r = parseResume(hhResume);
  assert.equal(r.hash, A);
  assert.equal(r.title, 'Frontend-разработчик');
  assert.equal(r.about, 'О себе: React.');
  assert.deepEqual(r.keySkills, ['React', 'TypeScript']);
  assert.equal(r.access, 'clients');
  assert.equal(r.updated, new Date(1792071673577).toISOString());
  assert.deepEqual(r.places[0], { hhId: 2092614619, company: 'Руб Икс', position: 'Senior Frontend Developer', description: 'Карты.', start: '2025-08-01', end: '2026-09-01' });
  assert.equal(r.places[1].hhId, null);
  assert.equal(r.places[1].end, '');
  assert.deepEqual(r.limits, { title: 100, about: 32768, keySkills: 30, keySkill: 100, position: 512, description: 32768, titleNotIn: ['Другое резюме'] });
  assert.equal(parseResume(null), null);
  assert.equal(parseResume({ title: [] }), null);
  assert.deepEqual(parseResume({ _attributes: { hash: B } }).limits, { ...RESUME_LIMITS, titleNotIn: [] });
});

test('resumeList + pickResume: видимое работодателям первым, по хешу, пусто', () => {
  const list = resumeList({
    applicantResumes: [
      { _attributes: { hash: B, status: 'new' }, title: [{ string: 'Копия' }], accessType: [{ string: 'no_one' }] },
      { _attributes: { hash: A, status: 'modified', updated: 1 }, title: [{ string: 'Основное' }], accessType: [{ string: 'clients' }] },
      { title: [{ string: 'без хеша' }] },
    ],
  });
  assert.deepEqual(list.map((r) => [r.hash, r.title, r.access]), [[B, 'Копия', 'no_one'], [A, 'Основное', 'clients']]);
  assert.equal(pickResume(list).hash, A);
  assert.equal(pickResume(list, B).hash, B);
  assert.equal(pickResume(list, 'nope'), null);
  assert.equal(pickResume([list[0]]).hash, B);
  assert.equal(pickResume([]), null);
  assert.deepEqual(resumeList(null), []);
});

test('parseResume на разведке E0 (fixtures/applier, не в git): 3 места, 30 навыков', (t) => {
  const root = new URL('../../fixtures/applier/', import.meta.url);
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('resume-')).sort().reverse() : [];
  const file = dirs
    .flatMap((d) => (existsSync(new URL(`${d}/`, root)) ? readdirSync(new URL(`${d}/`, root)).map((x) => new URL(`${d}/${x}/view/state.json`, root)) : []))
    .find((u) => existsSync(u));
  if (!file) return t.skip('нет разведки резюме');
  const r = parseResume(JSON.parse(readFileSync(file, 'utf8')).applicantResume);
  assert.ok(r.title.length > 2);
  assert.ok(r.places.length >= 1 && r.places.every((p) => p.hhId && p.company && p.position));
  assert.ok(r.keySkills.length <= r.limits.keySkills);
  assert.equal(r.limits.keySkills, 30);
});

test('предохранитель: сохранение опыта (resume-profile-front) рвётся, действия resume/profile открываются по одному', () => {
  const save = 'https://resume-profile-front.hh.ru/profile/shards/profile/update';
  const edit = `https://hh.ru/applicant/resume/edit?resume=${A}&hhtmSource=resume_partial_edit`;
  assert.ok(GUARD_URL.test(save) && GUARD_URL.test(edit));
  assert.ok(ACTION_URL.profile.test(save) && !ACTION_URL.profile.test(edit));
  assert.ok(ACTION_URL.resume.test(edit) && !ACTION_URL.resume.test(save));
  assert.ok(!ACTION_URL.resume.test('https://hh.ru/applicant/resume/edit_other'));
  assert.deepEqual(GUARD_ALLOW.resume, [ACTION_URL.resume]);
  assert.deepEqual(GUARD_ALLOW.profile, [ACTION_URL.profile]);
});
