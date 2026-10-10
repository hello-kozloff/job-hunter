// Знание о данных hh без браузера: разбор InitialState, факты вакансии для отклика, прогноз исхода, вырезание
// личных полей для разведки. Чистые функции — их проверяют тесты (applier/test) на сохранённых страницах.

// HTML-сущности раскодируем за один проход: иначе &amp;quot; станет кавычкой и сломает JSON.
// Копия декодера из n8n/shared/hh.js (Code-ноды n8n и этот сервис не делят модули)
const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// HTML страницы hh → объект InitialState (<template id="HH-Lux-InitialState">) или null
export function initialState(html) {
  const tpl = String(html ?? '').match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
  if (!tpl) return null;
  try {
    return JSON.parse(decodeEntities(tpl[1]));
  } catch {
    return null;
  }
}

// Страница капчи — только по структуре: слово «captcha» встречается и на обычных страницах (CLAUDE.md §8.1)
export function isCaptchaPage(url, html) {
  if (/\/account\/captcha/.test(String(url ?? ''))) return true;
  return /<form[^>]+action="[^"]*\/account\/captcha|name="captchaText"|<iframe[^>]+src="[^"]*smartcaptcha/i.test(
    String(html ?? ''),
  );
}

// Страницы входа и регистрации hh — всё под /account/ (кроме капчи)
export const isLoginUrl = (url) => /^https:\/\/(?:[a-z0-9-]+\.)*hh\.ru\/account\/(?!captcha)/.test(String(url ?? ''));

// Кто вошёл — cookie hhrole: applicant (соискатель) | anonymous | employer
export const roleFromCookies = (cookies) => (cookies ?? []).find((c) => c.name === 'hhrole')?.value ?? '';

// Факты вакансии для отклика: InitialState страницы /vacancy/<id>.
// Резюме и признак «уже откликались» (usedResumeIds) видны только вошедшему соискателю
export function vacancyFacts(state, id) {
  const vid = String(id);
  const full = state?.vacancyView?.vacancyFull ?? {};
  const v = full.vacancy ?? {};
  const resp = state?.applicantVacancyResponseStatuses?.[vid] ?? {};
  const short = resp.shortVacancy ?? {};
  const ids = (key) => (Array.isArray(resp[key]) ? resp[key].map(String) : []);
  return {
    vacancyId: vid,
    found: Boolean(v.vacancyId ?? v.name),
    userType: state?.userType ?? '',
    loggedIn: state?.userType === 'applicant',
    title: v.name ?? '',
    company: v.company?.visibleName ?? v.company?.name ?? '',
    archived: Boolean(v.status?.archived || v.status?.disabled),
    closed: Boolean(v.closedForApplicants ?? short.closedForApplicants),
    canApply: (full.features?.features ?? []).includes('canApply'),
    applied: ids('usedResumeIds').length > 0,
    resumes: {
      used: ids('usedResumeIds'),
      unused: ids('unusedResumeIds'),
      hidden: ids('hiddenResumeIds'),
      unfinished: ids('unfinishedResumeIds'),
    },
    hasTests: Boolean(resp.test?.hasTests ?? short.userTestPresent),
    testRequired: resp.test?.required ?? null,
    letterRequired: Boolean(short['@responseLetterRequired']),
    letterMax: Number(resp.letterMaxLength) || 10000,
    country: v.area?.countryIsoCode ?? '',
    chatWrite: short.chatWritePossibility ?? v.chatWritePossibility ?? '',
    autoResponse: Boolean(short.autoResponse?.acceptAutoResponse),
  };
}

// Ответ GET /applicant/vacancy_response/popup?vacancyId=N — его зовёт сам интерфейс hh при нажатии «Откликнуться».
// Формат точно узнаём на разведке, поэтому разбор терпимый: что нашлось — то и в прогноз
export function popupPrediction(body) {
  if (!body || typeof body !== 'object') return null;
  const inc = body.resumeInconsistencies;
  return {
    type: body.type ?? body.responseType ?? null,
    hasTests: Boolean(body.test?.hasTests),
    letterRequired: Boolean(body.letterRequired ?? body.responseLetterRequired),
    inconsistencies: Array.isArray(inc) ? inc.length : inc && typeof inc === 'object' ? Object.keys(inc).length : 0,
    keys: Object.keys(body).slice(0, 40),
  };
}

// Форма значения без самих данных — для отчётов разведки: ключи и типы, массивы — первый элемент и длина
export function shape(value, depth = 3) {
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth - 1), `×${value.length}`] : [];
  if (value && typeof value === 'object') {
    if (depth <= 0) return '{…}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth - 1)]));
  }
  return value === null ? 'null' : typeof value;
}

// Без личного и служебного: токены, данные аккаунта, переводы (4 тыс. строк), конфиг — для файлов разведки
const PRIVATE = [
  'xsrfToken',
  'account',
  'hhidAccount',
  'userId',
  'hhid',
  'session',
  'loginForm',
  'authUrl',
  'chatBot',
  'applicantSignup',
  'stayInTouch',
  'userTargeting',
  'request',
  'analyticsParams',
  'searchSessionId',
  'trl',
  'config',
  'footer',
  'headerMenu',
];
export function redactState(state) {
  if (!state || typeof state !== 'object') return state;
  const copy = { ...state };
  for (const key of PRIVATE) delete copy[key];
  return copy;
}

// Сводка страницы «Отклики» (6.2 уточнит по разведке): счётчики и форма одного отклика
export function negotiationsSummary(state) {
  const box = state?.applicantNegotiations ?? {};
  const list = Array.isArray(box.topicList) ? box.topicList : [];
  return {
    keys: Object.keys(box),
    topics: list.length,
    counters: state?.applicantNegotiationsCounters ?? null,
    sample: list.length ? shape(list[0], 3) : null,
  };
}

// Группа исхода отклика — по ней n8n (W9) решает, что делать со строкой, не зная тонкостей hh
export const GROUP = {
  applied: 'done',
  already: 'done',
  test: 'manual',
  external: 'manual',
  hidden: 'manual',
  archived: 'closed',
  captcha: 'block',
  login: 'block',
  limit: 'block',
  blocked: 'block',
  error: 'error',
  dry_run: 'dry',
};
