// Тесты чистых функций робота: разбор страниц hh и «день» робота. Запуск: cd applier && npm test
// Реальные страницы hh лежат в fixtures/ (не в git): тест с ними пропускается, если файла нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  decodeEntities,
  initialState,
  isCaptchaPage,
  isLoginUrl,
  negotiationTopics,
  negotiationsSummary,
  popupPrediction,
  redactState,
  roleFromCookies,
  shape,
  resumeChoice,
  vacancyFacts,
  vacancyResumes,
  GROUP,
} from '../src/hh/state.mjs';
import { robotDayStart, stamp } from '../src/util.mjs';
import { FORCE_QUICK, FORCE_QUICK_URL, GUARD_URL } from '../src/hh/selectors.mjs';

const fixture = (name) => new URL(`../../fixtures/${name}`, import.meta.url);
const page = (state) =>
  `<html><body><template id="HH-Lux-InitialState">${JSON.stringify(state).replace(/"/g, '&#34;')}</template></body></html>`;

test('decodeEntities: один проход, &amp;quot; не превращается в кавычку', () => {
  assert.equal(decodeEntities('&#34;a&#34; &amp;quot; &lt;b&gt; &#x41;'), '"a" &quot; <b> A');
});

test('initialState: шаблон с сущностями → объект; нет шаблона или битый JSON → null', () => {
  assert.deepEqual(initialState(page({ userType: 'applicant', n: 1 })), { userType: 'applicant', n: 1 });
  assert.equal(initialState('<html></html>'), null);
  assert.equal(initialState('<template id="HH-Lux-InitialState">{oops</template>'), null);
});

test('vacancyFacts: вошедший соискатель уже откликался → applied, резюме, письмо обязательно', () => {
  const state = {
    userType: 'applicant',
    vacancyView: {
      vacancyFull: {
        features: { features: ['canApply'] },
        vacancy: {
          vacancyId: 101,
          name: 'Frontend',
          company: { visibleName: 'Acme' },
          status: { archived: false },
          area: { countryIsoCode: 'GE' },
        },
      },
    },
    applicantVacancyResponseStatuses: {
      101: {
        test: { hasTests: false },
        letterMaxLength: 2000,
        usedResumeIds: [55],
        unusedResumeIds: [],
        shortVacancy: { '@responseLetterRequired': true, chatWritePossibility: 'ENABLED_AFTER_INVITATION' },
      },
    },
  };
  const f = vacancyFacts(state, 101);
  assert.equal(f.loggedIn, true);
  assert.equal(f.applied, true);
  assert.deepEqual(f.resumes.used, ['55']);
  assert.equal(f.letterRequired, true);
  assert.equal(f.letterMax, 2000);
  assert.equal(f.country, 'GE');
  assert.equal(f.canApply, true);
  assert.equal(f.archived, false);
  assert.equal(f.company, 'Acme');
});

test('vacancyFacts: архив, закрыта для откликов, тест из shortVacancy, пустое состояние', () => {
  const state = {
    userType: 'anonymous',
    vacancyView: { vacancyFull: { vacancy: { vacancyId: 7, status: { archived: true }, closedForApplicants: true } } },
    applicantVacancyResponseStatuses: { 7: { shortVacancy: { userTestPresent: true } } },
  };
  const f = vacancyFacts(state, '7');
  assert.equal(f.loggedIn, false);
  assert.equal(f.archived, true);
  assert.equal(f.closed, true);
  assert.equal(f.hasTests, true);
  assert.equal(f.letterMax, 10000);
  assert.equal(vacancyFacts(null, 1).found, false);
});

test('vacancyFacts на настоящей странице вакансии без входа', { skip: !existsSync(fixture('vacancy.html')) }, () => {
  const html = readFileSync(fixture('vacancy.html'), 'utf8');
  const state = initialState(html);
  assert.ok(state, 'InitialState разобран');
  const id = state.vacancyView.vacancyFull.vacancy.vacancyId;
  const f = vacancyFacts(state, id);
  assert.equal(f.found, true);
  assert.equal(f.loggedIn, false);
  assert.equal(f.applied, false);
  assert.equal(f.letterMax, 10000);
  assert.equal(isCaptchaPage(`https://hh.ru/vacancy/${id}`, html), false, 'обычная страница — не капча');
});

test('isCaptchaPage: по адресу и по форме, а не по слову', () => {
  const captcha = readFileSync(fixture('synthetic-captcha.html'), 'utf8');
  assert.equal(isCaptchaPage('https://hh.ru/vacancy/1', captcha), true);
  assert.equal(isCaptchaPage('https://hh.ru/account/captcha?backurl=%2F', ''), true);
  assert.equal(isCaptchaPage('https://hh.ru/vacancy/1', '<script>var t="captcha"</script>'), false);
});

test('isLoginUrl и roleFromCookies', () => {
  assert.equal(isLoginUrl('https://hh.ru/account/login?backurl=%2F'), true);
  assert.equal(isLoginUrl('https://spb.hh.ru/account/signup'), true);
  assert.equal(isLoginUrl('https://hh.ru/account/captcha'), false);
  assert.equal(isLoginUrl('https://hh.ru/vacancy/1'), false);
  assert.equal(roleFromCookies([{ name: 'hhrole', value: 'applicant' }]), 'applicant');
  assert.equal(roleFromCookies([]), '');
});

test('popupPrediction: типы hh из разведки и предупреждение «другая страна»', () => {
  assert.equal(popupPrediction(null), null);
  const modal = popupPrediction({
    type: 'modal',
    relocationWarning: { show: true },
    responseStatus: { test: { hasTests: false }, resumeInconsistencies: { a: 1 }, shortVacancy: { '@responseLetterRequired': true } },
  });
  assert.equal(modal.type, 'modal');
  assert.equal(modal.relocation, true);
  assert.equal(modal.letterRequired, true);
  assert.equal(modal.inconsistencies, 1);
  const quick = popupPrediction({ type: 'quickResponse', body: { resume_hash: 'h', letterRequired: false, responseStatus: {} } });
  assert.equal(quick.type, 'quickResponse');
  assert.equal(quick.letterRequired, false);
  assert.equal(quick.relocation, false);
  assert.equal(popupPrediction({ type: 'test-required', redirect_uri: '/x' }).hasTests, true);
  // Резюме по умолчанию: в окне — прошлого отклика, в один клик — resume_hash тела
  assert.equal(modal.defaultResume, '');
  assert.equal(popupPrediction({ type: 'modal', lastResponseResumeHash: 'abc', responseStatus: {} }).defaultResume, 'abc');
  assert.equal(quick.defaultResume, 'h');
});

// Страница вакансии у человека с двумя резюме (запись 16.10.2026): основное видно работодателям, копия скрыта
const AH = 'a'.repeat(38);
const BH = 'b'.repeat(38);
const CH = 'c'.repeat(38);
const twoResumes = (extra = {}) => ({
  applicantVacancyResponseStatuses: {
    5: {
      usedResumeIds: [],
      unusedResumeIds: ['11', '22'],
      resumes: {
        11: { _attributes: { id: '11', hash: AH }, title: [{ string: 'Frontend-разработчик' }], accessType: [{ string: 'clients' }] },
        22: { _attributes: { id: '22', hash: BH, parentResumeId: '11' }, title: [{ string: 'Fullstack-разработчик' }], accessType: [{ string: 'no_one' }] },
        33: { title: [{ string: 'без хеша' }] },
      },
      ...extra,
    },
  },
});

test('vacancyResumes: резюме со страницы вакансии — хеш, название, видимость, использовано', () => {
  const list = vacancyResumes(twoResumes({ usedResumeIds: ['22'] }), 5);
  assert.deepEqual(list, [
    { id: '11', hash: AH, title: 'Frontend-разработчик', access: 'clients', used: false },
    { id: '22', hash: BH, title: 'Fullstack-разработчик', access: 'no_one', used: true },
  ]);
  assert.deepEqual(vacancyResumes({}, 5), []);
  assert.deepEqual(vacancyResumes(null, 5), []);
  assert.deepEqual(vacancyResumes(twoResumes(), 6), [], 'чужая вакансия');
});

test('resumeChoice: нужное резюме — можно; уже откликались, скрыто, нет такого — нельзя до клика', () => {
  const list = vacancyResumes(twoResumes(), 5);
  assert.deepEqual(resumeChoice(list, { hash: AH, title: 'старое имя' }), { ok: true, id: '11', hash: AH, title: 'Frontend-разработчик' }, 'название — как сейчас на hh');
  assert.deepEqual(resumeChoice(list, { hash: AH }).title, 'Frontend-разработчик');
  const hidden = resumeChoice(list, { hash: BH });
  assert.equal(hidden.outcome, 'hidden');
  assert.match(hidden.note, /«Fullstack-разработчик» скрыто от работодателей/);
  const used = resumeChoice(vacancyResumes(twoResumes({ usedResumeIds: ['11'] }), 5), { hash: AH });
  assert.deepEqual([used.outcome, used.confirmed], ['already', true]);
  assert.match(used.note, /уже откликалось/);
  // этим резюме — уже, а другим — можно: «уже» не про всю вакансию
  assert.equal(resumeChoice(vacancyResumes(twoResumes({ usedResumeIds: ['11'] }), 5), { hash: BH }).outcome, 'hidden');
  const missing = resumeChoice(list, { hash: CH, title: 'Бухгалтер' });
  assert.equal(missing.outcome, 'error');
  assert.match(missing.note, /«Бухгалтер» нет среди резюме на hh/);
  assert.equal(resumeChoice([], { hash: AH }).outcome, 'error');
});

test('vacancyFacts: alreadyApplied и responseImpossible от hh вошедшему', () => {
  const state = {
    userType: 'applicant',
    vacancyView: { vacancyFull: { vacancy: { vacancyId: 9, name: 'X' } } },
    applicantVacancyResponseStatuses: { 9: { alreadyApplied: true, responseImpossible: true, usedResumeIds: [] } },
  };
  const f = vacancyFacts(state, 9);
  assert.equal(f.applied, true);
  assert.equal(f.responseImpossible, true);
});

test('redactState убирает токены и данные аккаунта, shape — только форма', () => {
  const r = redactState({ xsrfToken: 'x', account: { email: 'e' }, userId: 1, trl: {}, vacancyView: { a: 1 } });
  assert.deepEqual(Object.keys(r), ['vacancyView']);
  assert.deepEqual(shape({ a: [{ b: 1 }, { b: 2 }], c: null }), { a: [{ b: 'number' }, '×2'], c: 'null' });
});

test('negotiationsSummary: счётчики и форма одного отклика', () => {
  const s = negotiationsSummary({ applicantNegotiations: { topicList: [{ id: 1, state: 'RESPONSE' }] } });
  assert.equal(s.topics, 1);
  assert.deepEqual(s.sample, { id: 'number', state: 'string' });
  assert.equal(negotiationsSummary({}).topics, 0);
});

test('negotiationTopics: InitialState «Откликов» → id вакансий, даты, название и компания; страница и счётчики', () => {
  const state = {
    applicantNegotiations: {
      topicList: [
        { id: 11, vacancyId: 501, creationTime: '2026-10-08T16:36:39.383+03:00', lastModified: '2026-10-09T10:00:00.000+03:00', lastState: 'RESPONSE' },
        { id: 12, vacancyId: 502, creationTime: '2026-10-07T12:00:00.000+03:00', lastState: 'DISCARD' },
        { id: 13 },
      ],
      total: 136,
      pageCount: 7,
      paging: { pages: [{ page: 0, selected: false }, { page: 1, selected: true }] },
    },
    vacanciesShort: { vacanciesList: [{ vacancyId: 501, name: 'Senior Frontend', company: { id: 9736425, visibleName: 'Рога и копыта' } }] },
    applicantNegotiationsCounters: { new: { all: 0 }, total: { all: 136 } },
  };
  const r = negotiationTopics(state);
  assert.equal(r.found, true);
  assert.equal(r.selected, 1);
  assert.equal(r.pageCount, 7);
  assert.equal(r.total, 136);
  assert.deepEqual(r.counters.new, { all: 0 });
  assert.deepEqual(r.topics, [
    { topicId: '11', vacancyId: '501', creationTime: '2026-10-08T16:36:39.383+03:00', lastModified: '2026-10-09T10:00:00.000+03:00', name: 'Senior Frontend', companyId: '9736425', company: 'Рога и копыта' },
    { topicId: '12', vacancyId: '502', creationTime: '2026-10-07T12:00:00.000+03:00', lastModified: null, name: '', companyId: '', company: '' },
  ]);
});

test('negotiationTopics: JSON-ответ при листании — список глубже в объекте; без списка — found false', () => {
  const r = negotiationTopics({ data: { negotiations: { topicList: [{ id: 1, vacancyId: 7 }], paging: { pages: [{ page: 2, selected: true }] } } } });
  assert.equal(r.found, true);
  assert.equal(r.selected, 2);
  assert.deepEqual(r.topics.map((t) => t.vacancyId), ['7']);
  assert.equal(negotiationTopics({ other: 1 }).found, false);
  assert.equal(negotiationTopics(null).found, false);
});

test('negotiationTopics: сохранённая страница «Откликов» (fixtures, если есть)', { skip: !existsSync(fixture('applier/inbox-20261010-180531/negotiations.state.json')) }, () => {
  const state = JSON.parse(readFileSync(fixture('applier/inbox-20261010-180531/negotiations.state.json'), 'utf8'));
  const r = negotiationTopics(state);
  assert.equal(r.topics.length, 20);
  assert.equal(r.selected, 0);
  assert.ok(r.topics.every((t) => /^\d+$/.test(t.vacancyId) && t.creationTime));
  assert.ok(r.topics.filter((t) => t.companyId).length >= 15);
});

test('GROUP: у каждого исхода есть группа для n8n', () => {
  for (const outcome of ['applied', 'already', 'test', 'external', 'hidden', 'archived', 'captcha', 'login', 'limit', 'blocked', 'error', 'dry_run']) {
    assert.ok(GROUP[outcome], outcome);
  }
});

test('robotDayStart: «день» робота начинается в 09:00 по местному', () => {
  // Бангкок (UTC+7): 09:00 = 02:00 UTC
  assert.equal(robotDayStart(new Date('2026-10-11T05:00:00Z'), 'Asia/Bangkok').toISOString(), '2026-10-11T02:00:00.000Z');
  assert.equal(robotDayStart(new Date('2026-10-11T01:59:00Z'), 'Asia/Bangkok').toISOString(), '2026-10-10T02:00:00.000Z');
  assert.equal(robotDayStart(new Date('2026-10-11T02:00:00Z'), 'Asia/Bangkok').toISOString(), '2026-10-11T02:00:00.000Z');
  // Москва (UTC+3): 09:00 = 06:00 UTC; Нью-Йорк летом (UTC−4): 09:00 = 13:00 UTC
  assert.equal(robotDayStart(new Date('2026-10-11T05:00:00Z'), 'Europe/Moscow').toISOString(), '2026-10-10T06:00:00.000Z');
  assert.equal(robotDayStart(new Date('2026-07-11T14:00:00Z'), 'America/New_York').toISOString(), '2026-07-11T13:00:00.000Z');
  assert.equal(stamp(new Date('2026-10-11T07:05:09.123Z')), '20261011-070509');
});

test('предохранитель: адреса отклика, чатов и forceQuickResponse', () => {
  assert.ok(GUARD_URL.test('https://hh.ru/applicant/vacancy_response/popup'));
  assert.ok(GUARD_URL.test('https://spb.hh.ru/applicant/vacancy_response/edit_ajax'));
  assert.ok(GUARD_URL.test('https://chatik.hh.ru/chatik/api/save'));
  assert.ok(!GUARD_URL.test('https://hh.ru/vacancy/138092086'));
  const forced = 'https://hh.ru/vacancy/138092086?forceQuickResponse=true';
  assert.ok(FORCE_QUICK_URL.test(forced) && FORCE_QUICK.test(forced));
  assert.ok(!FORCE_QUICK.test('https://hh.ru/vacancy/138092086?from=telegram'));
});
