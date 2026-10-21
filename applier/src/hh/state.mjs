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

// Вакансия в закрытом режиме (20.10.2026): hh отдаёт 403 и свою страницу «Вам недоступна эта вакансия. Войдите как
// пользователь, у которого есть доступ на просмотр…» — luxPageName ForbiddenPage (не зависит от языка сайта). Для
// соискателя она закрыта, как архивная. Другой 403 (антибот, сбой) — не она
export const isForbiddenVacancy = (status, html) => status === 403 && /"luxPageName":\s*"ForbiddenPage"/.test(String(html ?? ''));

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
    // Вошедшему hh отдаёт и прямой признак alreadyApplied; responseImpossible — откликнуться нельзя (уже, закрыта)
    applied: ids('usedResumeIds').length > 0 || resp.alreadyApplied === true,
    responseImpossible: resp.responseImpossible === true,
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

// Резюме человека на странице вакансии (InitialState → applicantVacancyResponseStatuses[id].resumes) — из них hh собирает
// список в окне отклика (запись 16.10.2026, два резюме). [{ id, hash, title, access, used }]: access — clients (видно
// работодателям) или no_one (скрыто), used — этим резюме на вакансию уже откликались
export function vacancyResumes(state, id) {
  const resp = state?.applicantVacancyResponseStatuses?.[String(id)] ?? {};
  const used = new Set((Array.isArray(resp.usedResumeIds) ? resp.usedResumeIds : []).map(String));
  const first = (v) => String((Array.isArray(v) ? v[0]?.string : (v?.string ?? v)) ?? '').trim();
  return Object.entries(resp.resumes ?? {})
    .map(([rid, r]) => ({
      id: String(r?._attributes?.id ?? rid),
      hash: String(r?._attributes?.hash ?? ''),
      title: first(r?.title),
      access: first(r?.accessType),
      used: used.has(String(rid)),
    }))
    .filter((r) => r.hash);
}

// Каким резюме откликаться — решение до клика. wanted — { hash, title? }: резюме, которое бот привязал к вакансии.
// → { ok: true, id, hash, title } или { outcome: error | already | hidden, note }: откликаться не надо
export function resumeChoice(resumes, wanted) {
  const name = wanted.title ? `«${wanted.title}»` : 'выбранного в боте';
  const found = resumes.find((r) => r.hash === wanted.hash);
  if (!found) {
    return { outcome: 'error', note: `резюме ${name} нет среди резюме на hh для этого отклика (удалено или перепривязано?): ⚙️ → 📄 Резюме → 📥 Импорт с hh` };
  }
  const title = found.title || wanted.title || '';
  if (found.used) return { outcome: 'already', confirmed: true, note: `резюме «${title}» уже откликалось на эту вакансию` };
  if (found.access === 'no_one') return { outcome: 'hidden', note: `резюме «${title}» скрыто от работодателей: открой его на hh и повтори` };
  return { ok: true, id: found.id, hash: found.hash, title };
}

// Ответ GET /applicant/vacancy_response/popup — его зовёт сам интерфейс hh при нажатии «Откликнуться» и по type решает,
// что показать (разведка 10.10.2026):
//   modal          — окно с письмом до отправки (responsePopup, responseStatus, relocationWarning, lastResponseLetter);
//   quickResponse  — отклик уходит сразу, письмо — после (body: resume_hash, vacancy_id, letterRequired, responseStatus);
//   test-required  — страница вопросов работодателя (redirect_uri);
//   alreadyApplied — отклик уже есть;   need-login — не вошли.
// relocationWarning.show — покажет ли hh «Вы откликаетесь на вакансию в другой стране»
export function popupPrediction(body) {
  if (!body || typeof body !== 'object') return null;
  const status = body.responseStatus ?? body.body?.responseStatus ?? {};
  const inc = status.resumeInconsistencies;
  return {
    type: body.type ?? null,
    relocation: Boolean(body.relocationWarning?.show),
    letterRequired: Boolean(body.body?.letterRequired ?? status.shortVacancy?.['@responseLetterRequired']),
    hasTests: body.type === 'test-required' || Boolean(status.test?.hasTests),
    inconsistencies: Array.isArray(inc) ? inc.length : inc && typeof inc === 'object' ? Object.keys(inc).length : 0,
    responseAllowed: status.by_country_applicant_visibility?.responseAllowed ?? null,
    // Резюме по умолчанию: выбрано в окне (прошлый отклик) или уйдёт с откликом в один клик
    defaultResume: String(body.lastResponseResumeHash ?? body.body?.resume_hash ?? ''),
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

// Отклики одной страницы «Откликов» (сверка с таблицей, docs/hh-applied.md): id вакансии, когда откликнулись, название
// и компания — без HR, писем и чатов. json — InitialState страницы или JSON-ответ hh при листании (его форма не
// записана: ищем объект с topicList и список vacanciesList не глубже 4 уровней). selected — номер страницы с нуля
function holder(o, key, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 4) return null;
  if (Array.isArray(o[key])) return o;
  for (const v of Object.values(o)) {
    const found = holder(v, key, depth + 1);
    if (found) return found;
  }
  return null;
}
export function negotiationTopics(json) {
  const box = json?.applicantNegotiations ?? holder(json, 'topicList') ?? {};
  const shorts = json?.vacanciesShort?.vacanciesList ?? holder(json, 'vacanciesList')?.vacanciesList ?? [];
  const byId = new Map(shorts.map((v) => [String(v?.vacancyId), v]));
  const list = Array.isArray(box.topicList) ? box.topicList : [];
  return {
    found: Array.isArray(box.topicList),
    selected: box.paging?.pages?.find((p) => p.selected)?.page ?? null,
    pageCount: box.pageCount ?? null,
    total: box.total ?? null,
    counters: json?.applicantNegotiationsCounters ?? null,
    topics: list
      .filter((t) => t?.vacancyId)
      .map((t) => {
        const v = byId.get(String(t.vacancyId)) ?? {};
        return {
          topicId: String(t.id ?? ''),
          vacancyId: String(t.vacancyId),
          creationTime: t.creationTime ?? null,
          lastModified: t.lastModified ?? null,
          name: String(v.name ?? ''),
          companyId: v.company?.id != null ? String(v.company.id) : '',
          company: String(v.company?.visibleName ?? v.company?.name ?? ''),
        };
      }),
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
