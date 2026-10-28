// Тесты чистых функций робота: разбор страниц hh и «день» робота. Запуск: cd applier && npm test
// Реальные страницы hh лежат в fixtures/ (не в git): тест с ними пропускается, если файла нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  chatFacts,
  chatTranslations,
  decodeEntities,
  initialState,
  isCaptchaPage,
  isLoginUrl,
  negotiationCensus,
  negotiationTopics,
  negotiationsSummary,
  popupPrediction,
  redactState,
  roleFromCookies,
  shape,
  resumeChoice,
  vacancyFacts,
  vacancyResumes,
  vacancyTopic,
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
  // Поля сверки hh-applied; статусы для напоминаний (6.3) — тест ниже
  const base = ({ topicId, vacancyId, creationTime, lastModified, name, companyId, company }) => ({ topicId, vacancyId, creationTime, lastModified, name, companyId, company });
  assert.deepEqual(r.topics.map(base), [
    { topicId: '11', vacancyId: '501', creationTime: '2026-10-08T16:36:39.383+03:00', lastModified: '2026-10-09T10:00:00.000+03:00', name: 'Senior Frontend', companyId: '9736425', company: 'Рога и копыта' },
    { topicId: '12', vacancyId: '502', creationTime: '2026-10-07T12:00:00.000+03:00', lastModified: null, name: '', companyId: '', company: '' },
  ]);
  assert.deepEqual(r.topics.map((t) => t.lastState), ['RESPONSE', 'DISCARD']);
});

test('negotiationTopics: статус отклика и переписка для напоминаний (6.3)', () => {
  const r = negotiationTopics({
    applicantNegotiations: {
      topicList: [
        {
          id: 21,
          vacancyId: 601,
          chatId: 5687620779,
          lastState: 'RESPONSE',
          viewedByOpponent: false,
          hasNewMessages: false,
          conversationMessagesCount: 1,
          conversationUnreadByEmployerCount: 1,
          inboxAvailabilityState: 'AVAILABLE',
          responseReminderState: { allowed: true },
          chatIsArchived: false,
        },
        { id: 22, vacancyId: 602, communicationContext: { chatData: { id: 77 } }, lastState: 'DISCARD', viewedByOpponent: true, declinedByApplicant: true, archived: true },
      ],
    },
    vacanciesShort: { vacanciesList: [{ vacancyId: 601, chatWritePossibility: 'ENABLED_AFTER_INVITATION', closedForApplicants: false }, { vacancyId: 602, chatWritePossibility: 'DISABLED', closedForApplicants: true }] },
  });
  const [a, b] = r.topics;
  assert.deepEqual(
    [a.chatId, a.lastState, a.viewed, a.messages, a.unreadByEmployer, a.inbox, a.reminderAllowed, a.chatWrite, a.closed],
    ['5687620779', 'RESPONSE', false, 1, 1, 'AVAILABLE', true, 'ENABLED_AFTER_INVITATION', false],
  );
  assert.deepEqual([b.chatId, b.viewed, b.declined, b.archived, b.chatWrite, b.closed, b.reminderAllowed], ['77', true, true, true, 'DISABLED', true, false]);
});

test('vacancyTopic: отклик на странице вакансии — тот же топик; нет отклика — null', () => {
  const state = {
    applicantVacancyResponseStatuses: {
      700: { negotiations: { topicList: [{ id: 5, vacancyId: 700, lastState: 'INTERVIEW', viewedByOpponent: false, creationTime: '2026-10-14T14:02:29.830+03:00' }] } },
    },
    vacancyChatInfo: { 700: { data: { chatId: 99 } } },
  };
  const t = vacancyTopic(state, 700);
  assert.deepEqual([t.topicId, t.lastState, t.viewed, t.chatId, t.creationTime], ['5', 'INTERVIEW', false, '99', '2026-10-14T14:02:29.830+03:00']);
  assert.equal(vacancyTopic(state, 701), null);
  assert.equal(vacancyTopic(null, 700), null);
});

test('vacancyTopic: сохранённые страницы вакансий (fixtures, если есть)', { skip: !existsSync(fixture('applier/recon-20261019-092315/138505603/state.json')) }, () => {
  const read = (dir, id) => vacancyTopic(JSON.parse(readFileSync(fixture(`applier/${dir}/${id}/state.json`), 'utf8')), id);
  // Приглашение, хотя работодатель «не просматривал» отклик: статус важнее признака просмотра
  const invited = read('recon-20261019-092315', '138505603');
  assert.deepEqual([invited.lastState, invited.viewed], ['INTERVIEW', false]);
  const waiting = read('recon-20261019-092315', '138476552');
  assert.deepEqual([waiting.lastState, waiting.viewed, waiting.reminderAllowed, waiting.chatId], ['RESPONSE', false, true, '5710398353']);
});

test('negotiationCensus: кандидаты в напоминание — ждёт ответа, не просмотрен, старше 3 дней', () => {
  const now = Date.parse('2026-10-28T12:00:00+03:00');
  const day = (n) => new Date(now - n * 86400000).toISOString();
  const c = negotiationCensus(
    [
      { lastState: 'RESPONSE', viewed: false, creationTime: day(4), chatWrite: 'ENABLED_AFTER_INVITATION', inbox: 'AVAILABLE', reminderAllowed: true },
      { lastState: 'RESPONSE', viewed: false, creationTime: day(20), chatWrite: 'ENABLED_AFTER_INVITATION', inbox: 'AVAILABLE', closed: true },
      { lastState: 'RESPONSE', viewed: false, creationTime: day(1), chatWrite: 'DISABLED', inbox: 'AVAILABLE' },
      { lastState: 'RESPONSE', viewed: true, creationTime: day(10), chatWrite: 'DISABLED', inbox: 'AVAILABLE' },
      { lastState: 'DISCARD', viewed: true, creationTime: day(10), inbox: 'WITHOUT_INVITATION' },
      { lastState: '', creationTime: null },
    ],
    now,
  );
  assert.equal(c.total, 6);
  assert.deepEqual(c.state, { 'RESPONSE не просмотрен': 3, 'RESPONSE просмотрен': 1, DISCARD: 1, '—': 1 });
  assert.equal(c.candidates.total, 2);
  assert.deepEqual(c.candidates.age, { '3–6 дн.': 1, '14–29 дн.': 1 });
  assert.deepEqual(c.candidates.chat, { 'ENABLED_AFTER_INVITATION · AVAILABLE': 2 });
  assert.deepEqual([c.candidates.reminderAllowed, c.candidates.closed], [1, 1]);
});

test('chatFacts: можно ли писать и кто писал — без текстов и имён', () => {
  const f = chatFacts({
    chat: {
      id: 5700103809,
      type: 'NEGOTIATION',
      currentParticipantId: 'me',
      unreadCount: 0,
      writePossibility: { name: 'DISABLED_FOR_APPLICANT_BY_VACANCY_SETTINGS', writeDisabledReasons: ['DISABLED_BY_EMPLOYER'] },
      operations: { allowed: ['LEAVE_CHAT'] },
      messages: {
        items: [
          { id: 1, participantId: 'me', text: 'Здравствуйте, письмо', type: 'SIMPLE', workflowTransition: { applicantState: 'RESPONSE' }, canEdit: true, participantDisplay: { name: 'Никита', isBot: false } },
          { id: 2, participantId: 'hr', text: 'Спасибо за отклик', type: 'SIMPLE', participantDisplay: { name: 'Анна', isBot: true } },
        ],
        hasMore: false,
      },
    },
    chatStates: { writeMessageState: { allowed: false, reasons: ['DISABLED_BY_EMPLOYER'] }, responseReminderState: { allowed: false }, sendFileState: { allowed: true } },
  });
  assert.deepEqual([f.found, f.chatId, f.write.allowed, f.write.reasons, f.write.possibility, f.reminderAllowed], [true, '5700103809', false, ['DISABLED_BY_EMPLOYER'], 'DISABLED_FOR_APPLICANT_BY_VACANCY_SETTINGS', false]);
  assert.deepEqual(f.messages.map((m) => [m.mine, m.bot, m.state, m.length]), [[true, false, 'RESPONSE', 20], [false, true, null, 17]]);
  assert.ok(!JSON.stringify(f).includes('Никита') && !JSON.stringify(f).includes('Спасибо'), 'имён и текстов нет');
  assert.equal(chatFacts(null).found, false);
});

test('chatFacts: записанный chat_data (fixtures, если есть)', { skip: !existsSync(fixture('applier/record-20261010-181350/049-xhr-GET-chatik-api-chat-data-chatId-5700103809-applicantId-12143166.txt')) }, () => {
  const text = readFileSync(fixture('applier/record-20261010-181350/049-xhr-GET-chatik-api-chat-data-chatId-5700103809-applicantId-12143166.txt'), 'utf8');
  const f = chatFacts(JSON.parse(text.slice(text.indexOf('\n{') + 1)));
  assert.deepEqual([f.found, f.write.allowed, f.write.reasons], [true, false, ['DISABLED_BY_EMPLOYER']]);
  assert.ok(f.messages.some((m) => m.mine && m.state === 'RESPONSE'), 'сообщение отклика — моё');
});

test('chatTranslations: переводы chatik.* из HTML кадра чата', () => {
  const html = '<script>{&quot;chatik.warning.withoutInvitation.applicant&quot;:&quot;Переписка будет доступна после приглашения&quot;,&quot;other.key&quot;:&quot;x&quot;,&quot;chatik.a\\u0022b&quot;:&quot;1&quot;}</script>';
  const t = chatTranslations(html);
  assert.equal(t['chatik.warning.withoutInvitation.applicant'], 'Переписка будет доступна после приглашения');
  assert.equal(t['other.key'], undefined);
  assert.deepEqual(chatTranslations(''), {});
});

test('chatTranslations: записанный кадр чата (fixtures, если есть)', { skip: !existsSync(fixture('applier/record-20261010-181350/043-xhr-GET-chat-5700103809-without-list-1-platform-xhh-theme-hh-day-de.txt')) }, () => {
  const t = chatTranslations(readFileSync(fixture('applier/record-20261010-181350/043-xhr-GET-chat-5700103809-without-list-1-platform-xhh-theme-hh-day-de.txt'), 'utf8'));
  assert.ok(Object.keys(t).length > 200);
  // В переводах hh неразрывные пробелы — сравниваем по словам
  assert.equal(t['chatik.warning.disabledByEmployer.applicant'].replace(/\s+/g, ' '), 'Работодатель отключил переписку по данной вакансии');
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
