// Ответы hh на действия живого отклика — чистые функции без Playwright (тесты: applier/test/xhr.test.mjs).
// Запись 10.10.2026 (fixtures/applier/record-20261010-181350, docs/stages/stage-6.md → «Запись»):
//   POST /applicant/vacancy_response/popup → { success: "true", topic_id, chat_id, response_label, responseStatus };
//     response_label «…-with-letter» — письмо ушло вместе с откликом, «…-without-letter» — без него;
//     ошибка — код из переводов hh vacancy.response.popup.<код>: negotiationsLimitExceeded, spamDetected…
//   POST /applicant/vacancy_response/edit_ajax {topicId, text} → в записи 403 {"error":"notEditable"}: к отклику
//     «в один клик» письмо так не приложилось → запасной путь — чат отклика;
//   POST chatik.hh.ru/chatik/api/save {text, messageId} → 200: письмо встало в сообщение отклика в чате.
import { TEXT } from './selectors.mjs';

// Код ошибки hh → исход (группы — state.mjs GROUP). Нет в списке — error со скриншотом
export const ERROR_OUTCOME = {
  negotiationsLimitExceeded: 'limit',
  spamDetected: 'blocked',
  resourcePolicyViolation: 'blocked',
  inappropriateLanguage: 'blocked',
  alreadyApplied: 'already',
  changeResumeVisibilityDenied: 'hidden',
  test: 'test',
  testRequired: 'test',
};

// Код ошибки из ответа hh: строка в error / errorCode / code или в errors[] — формат точно не известен (ошибок
// отклика в записи не было), поэтому терпимо. «negotiationsLimitExceeded.error» → «negotiationsLimitExceeded»
export function errorCode(body) {
  if (!body || typeof body !== 'object') return '';
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const found = [
    body.error,
    body.errorCode,
    body.code,
    ...errors.flatMap((e) => (typeof e === 'string' ? [e] : [e?.type, e?.value, e?.code])),
  ].find((c) => typeof c === 'string' && c.trim());
  return found ? found.trim().replace(/\.error$/, '') : '';
}

// Поле multipart/form-data из тела запроса (Playwright request.postData()) — '' если нет
export function multipartField(postData, name) {
  const m = String(postData ?? '').match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`));
  return m ? m[1] : '';
}

const ok2xx = (status) => status >= 200 && status < 300;

// Ответ на сам отклик. letter — ушло ли письмо вместе с ним: по response_label, без него — по полю letter запроса
export function respondResult(status, body, postData = '') {
  const ok = ok2xx(status) && String(body?.success) === 'true';
  const label = String(body?.response_label ?? '');
  const rs = body?.responseStatus ?? {};
  const code = ok ? '' : errorCode(body);
  const sentLetter = label ? /-with-letter$/.test(label) : multipartField(postData, 'letter').trim().length > 0;
  return {
    ok,
    outcome: ok ? 'applied' : (ERROR_OUTCOME[code] ?? 'error'),
    code,
    letter: ok ? (sentLetter ? 'attached' : 'none') : '',
    // hh сам говорит в ответе, что отклик есть: alreadyApplied или резюме среди использованных
    confirmed: ok && (rs.alreadyApplied === true || (Array.isArray(rs.usedResumeIds) && rs.usedResumeIds.length > 0)),
    topicId: body?.topic_id ? String(body.topic_id) : '',
    chatId: body?.chat_id ? String(body.chat_id) : '',
  };
}

// «Приложить сопроводительное письмо» (edit_ajax): 2xx без кода ошибки — приложено
export function letterResult(status, body) {
  const code = errorCode(body);
  return { ok: ok2xx(status) && !code, code: code || (ok2xx(status) ? '' : `HTTP ${status || 'нет ответа'}`) };
}

// Письмо в чат отклика (chatik save): ответ — общие настройки чата, успех — только по коду
export const chatResult = (status) => ({ ok: ok2xx(status), code: ok2xx(status) ? '' : `HTTP ${status || 'нет ответа'}` });

// Тексты hh на экране после клика → исход. Сравнение с текстом до клика: описание вакансии может случайно
// содержать те же слова — считается только то, чего до клика не было
const SCREEN_TEXTS = [
  ['limit', TEXT.limit],
  ['blocked', TEXT.stop],
  ['hidden', TEXT.hidden],
  ['test', TEXT.test],
  ['failed', TEXT.failed],
  ['responded', TEXT.responded],
];
export function screenText(now, before = '') {
  const [after, was] = [plain(now), plain(before)];
  for (const [outcome, re] of SCREEN_TEXTS) {
    const m = after.match(re);
    if (m && !re.test(was)) return { outcome, text: m[0] };
  }
  return null;
}

// Неразрывные пробелы (в переводах hh — &nbsp;: «с&nbsp;текущей видимостью») → обычные: маркеры написаны с пробелами
export const plain = (s) => String(s ?? '').replace(/[\u00a0\u202f]/g, ' ');

// Письмо в поле — то же, что просили вставить (переводы строк браузер приводит к \n)
export const sameText = (a, b) =>
  String(a ?? '').replace(/\r\n?/g, '\n').trim() === String(b ?? '').replace(/\r\n?/g, '\n').trim();
