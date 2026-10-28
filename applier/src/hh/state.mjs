// Знание о данных hh без браузера: разбор InitialState, факты вакансии для отклика, прогноз исхода, вырезание
// личных полей для разведки. Чистые функции — их проверяют тесты (applier/test) на сохранённых страницах.
import { sameText } from './xhr.mjs';

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
          ...topicState(t),
          // Можно ли соискателю писать в чат по настройке вакансии: ENABLED_AFTER_INVITATION | DISABLED | …
          chatWrite: String(v.chatWritePossibility ?? ''),
          closed: v.closedForApplicants === true,
        };
      }),
  };
}

// Состояние отклика (топика переписки hh) для напоминаний (6.3): что с ним у работодателя — lastState (RESPONSE — ждёт
// ответа, DISCARD — отказ, INTERVIEW и другие — приглашение; INTERVIEW бывает и при viewedByOpponent = false), открыл ли
// его работодатель, чат и счётчики сообщений. Тексты и имена не берём
function topicState(t) {
  return {
    chatId: String(t?.chatId ?? t?.communicationContext?.chatData?.id ?? ''),
    lastState: String(t?.lastState ?? ''),
    viewed: t?.viewedByOpponent === true,
    declined: t?.declinedByApplicant === true,
    archived: t?.archived === true,
    chatArchived: t?.chatIsArchived === true,
    hasNewMessages: t?.hasNewMessages === true,
    messages: Number(t?.conversationMessagesCount) || 0,
    unreadByEmployer: Number(t?.conversationUnreadByEmployerCount) || 0,
    // AVAILABLE | WITHOUT_INVITATION | DISABLED_BY_EMPLOYER
    inbox: String(t?.inboxAvailabilityState ?? ''),
    // Встроенное «напомнить» hh: включается у непросмотренных откликов старше ~3 дней (разведка 10–19.10.2026)
    reminderAllowed: t?.responseReminderState?.allowed === true,
  };
}

// Отклик на странице вакансии (6.3): applicantVacancyResponseStatuses[id].negotiations.topicList — тот же топик, что
// в «Откликах»; chatId есть и в vacancyChatInfo[id]. Отклика нет — null
export function vacancyTopic(state, id) {
  const vid = String(id);
  const list = state?.applicantVacancyResponseStatuses?.[vid]?.negotiations?.topicList;
  const t = Array.isArray(list) ? (list.find((x) => String(x?.vacancyId) === vid) ?? list[0]) : null;
  if (!t) return null;
  const s = topicState(t);
  return {
    topicId: String(t.id ?? ''),
    creationTime: t.creationTime ?? null,
    ...s,
    chatId: s.chatId || String(state?.vacancyChatInfo?.[vid]?.data?.chatId ?? ''),
  };
}

// Перепись откликов (6.3a): сколько каких — по статусу у работодателя, а кандидатов в напоминание (ждёт ответа, не
// просмотрен, старше 3 дней) — по возрасту и тому, можно ли писать в чат. Отклики без статуса (из разметки) — «—»
const CENSUS_AGE = [
  [7, '3–6 дн.'],
  [14, '7–13 дн.'],
  [30, '14–29 дн.'],
  [Infinity, '30+ дн.'],
];
export function negotiationCensus(topics, now = Date.now()) {
  const inc = (o, k) => {
    o[k || '—'] = (o[k || '—'] ?? 0) + 1;
  };
  const out = { total: 0, state: {}, candidates: { total: 0, age: {}, chat: {}, reminderAllowed: 0, chatArchived: 0, closed: 0 } };
  for (const t of topics ?? []) {
    out.total++;
    inc(out.state, t.lastState === 'RESPONSE' ? `RESPONSE ${t.viewed ? 'просмотрен' : 'не просмотрен'}` : t.lastState);
    const age = (now - Date.parse(t.creationTime)) / 86400000;
    if (t.lastState !== 'RESPONSE' || t.viewed || !(age >= 3)) continue;
    const c = out.candidates;
    c.total++;
    inc(c.age, CENSUS_AGE.find(([days]) => age < days)[1]);
    // Настройка вакансии × что hh говорит о переписке в топике
    inc(c.chat, `${t.chatWrite || '—'} · ${t.inbox || '—'}`);
    if (t.reminderAllowed) c.reminderAllowed++;
    if (t.chatArchived) c.chatArchived++;
    if (t.closed) c.closed++;
  }
  return out;
}

// Ответ chatik/api/chat_data (чат отклика, 6.3) без текстов и имён: можно ли писать и почему нет, встроенное
// «напомнить», кто и когда писал (mine — соискатель, bot — автоответ работодателя), прочитал ли работодатель
export function chatFacts(body) {
  const chat = body?.chat ?? {};
  const states = body?.chatStates ?? {};
  const me = String(chat.currentParticipantId ?? '');
  const items = Array.isArray(chat.messages?.items) ? chat.messages.items : [];
  return {
    found: Boolean(chat.id),
    chatId: String(chat.id ?? ''),
    type: String(chat.type ?? ''),
    write: {
      allowed: states.writeMessageState?.allowed ?? null,
      reasons: states.writeMessageState?.reasons ?? [],
      possibility: String(chat.writePossibility?.name ?? ''),
      disabledReasons: chat.writePossibility?.writeDisabledReasons ?? [],
    },
    reminderAllowed: states.responseReminderState?.allowed ?? null,
    sendFile: states.sendFileState?.allowed ?? null,
    states: Object.keys(states),
    operations: chat.operations?.allowed ?? [],
    unread: Number(chat.unreadCount) || 0,
    blocked: Boolean(chat.blockInfo),
    lastViewedByOpponent: String(chat.lastViewedByOpponentMessageId ?? ''),
    messages: items.map((m) => ({
      id: String(m.id ?? ''),
      at: m.creationTime ?? null,
      type: String(m.type ?? ''),
      mine: me !== '' && String(m.participantId ?? '') === me,
      bot: m.participantDisplay?.isBot === true,
      state: m.workflowTransition?.applicantState ?? null,
      length: String(m.text ?? '').length,
      canEdit: m.canEdit === true,
    })),
    hasMore: chat.messages?.hasMore === true,
    keys: Object.keys(body ?? {}),
  };
}

// Переводы интерфейса чата (chatik.*) из HTML кадра чата: подписи поля, предупреждения «писать нельзя», ошибки отправки
export function chatTranslations(html) {
  const text = decodeEntities(String(html ?? ''));
  const out = {};
  for (const m of text.matchAll(/"(chatik\.[A-Za-z0-9._-]+)":"((?:[^"\\]|\\.)*)"/g)) {
    try {
      out[m[1]] = JSON.parse(`"${m[2]}"`);
    } catch {
      out[m[1]] = m[2];
    }
  }
  return out;
}

// ---------- Напоминание об отклике (этап 6.3) ----------

// Группа исхода напоминания — по ней n8n (W9) решает, что делать со строкой: done и skip — итог, больше не напоминать;
// later — отклик молод, снова кандидат; dry — сухой прогон; block — капча, вход, «спам» (тревога, ждём человека)
export const REMIND_GROUP = {
  sent: 'done',
  already: 'done',
  viewed: 'skip',
  invited: 'skip',
  rejected: 'skip',
  wrote: 'skip',
  closed: 'skip',
  archived: 'skip',
  no_topic: 'skip',
  too_early: 'later',
  dry_run: 'dry',
  captcha: 'block',
  login: 'block',
  blocked: 'block',
  error: 'error',
};

// Текст напоминания: непустой, ≤ 500 знаков, без ссылок → '' или причина отказа
export function remindTextError(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'нужен text — текст напоминания';
  if (t.length > 500) return 'текст напоминания длиннее 500 знаков';
  if (/https?:\/\/|www\./i.test(t)) return 'ссылки в напоминании не отправляем';
  return '';
}

// Можно ли напоминать — по странице вакансии, до открытия чата: открытие шлёт hh «чат открыт». null — открывать чат.
// Порядок важен: статус раньше просмотра (INTERVIEW бывает при viewedByOpponent = false, 138505603). Число сообщений и
// hasNewMessages не мешают: автоответ бота работодателя приходит без просмотра отклика — такому напомнить можно
const REMIND_AGE_MS = 3 * 24 * 3600 * 1000;
export function remindFromTopic(facts, topic, now = Date.now()) {
  if (facts.archived || facts.closed || topic?.archived) return { outcome: 'archived', note: 'вакансия закрыта' };
  if (!topic) return { outcome: 'no_topic', note: 'отклика на hh нет' };
  if (topic.declined) return { outcome: 'rejected', note: 'вы отказались от отклика' };
  if (topic.lastState === 'DISCARD') return { outcome: 'rejected', note: 'отказ работодателя' };
  if (topic.lastState !== 'RESPONSE') return { outcome: 'invited', note: `статус на hh: ${topic.lastState || 'неизвестен'}` };
  if (topic.viewed) return { outcome: 'viewed', note: 'работодатель уже открыл отклик' };
  const at = Date.parse(topic.creationTime);
  if (at && now - at < REMIND_AGE_MS) return { outcome: 'too_early', note: `отклику меньше 3 дней (${String(topic.creationTime).slice(0, 10)})` };
  if (facts.chatWrite === 'DISABLED' || topic.inbox === 'DISABLED_BY_EMPLOYER') return { outcome: 'closed', note: 'работодатель отключил переписку' };
  if (topic.chatArchived) return { outcome: 'closed', note: 'чат отклика в архиве' };
  if (!topic.chatId) return { outcome: 'error', note: 'у отклика нет чата' };
  return null;
}

// Можно ли напоминать — по chat_data, которые грузит сам кадр чата. null — отправлять. Сообщения после сообщения
// отклика (у него workflowTransition): наше с этим текстом — уже напомнили (повтор после сбоя), наше другое — человек
// уже писал сам, не бота работодателя — работодатель на связи. Бот работодателя (автоответ, вопросы) не мешает
export function remindFromChat(body, text) {
  const chat = body?.chat;
  if (!chat?.id) return null;
  const me = String(chat.currentParticipantId ?? '');
  const items = Array.isArray(chat.messages?.items) ? chat.messages.items : [];
  const mine = (m) => me !== '' && String(m.participantId ?? '') === me;
  const later = items.filter((m) => !m.workflowTransition);
  if (later.some((m) => mine(m) && sameText(m.text, text))) return { outcome: 'already', note: 'напоминание уже в чате' };
  if (later.some(mine)) return { outcome: 'wrote', note: 'в чат уже писали после отклика' };
  if (later.some((m) => !mine(m) && m.participantDisplay?.isBot !== true)) return { outcome: 'viewed', note: 'работодатель уже писал в чат' };
  const write = body.chatStates?.writeMessageState;
  if (write?.allowed === false) {
    const why = [...(write.reasons ?? []), ...(chat.writePossibility?.writeDisabledReasons ?? [])];
    return { outcome: 'closed', note: `писать нельзя: ${[...new Set(why)].join(', ') || chat.writePossibility?.name || 'hh не даёт'}` };
  }
  return null;
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
