// W0 · Check search — проверка ответа поиска hh.ru.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответ HTTP Request «Search hh» (Response Format = Text,
//       Include Response Headers and Status = on).
// Выход: один item со сводкой, вердиктом и vacancyId для запроса страницы вакансии.

const res = $input.first().json;
const status = res.statusCode ?? null;
// Текст ответа HTTP Request (Response Format = Text) n8n кладёт в поле data
const html = String(res.data ?? res.body ?? '');

// HTML-сущности раскодируем за один проход: иначе &amp;quot; станет кавычкой и сломает JSON
const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: '\u00a0' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const tpl = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
let state = null;
let parseError = null;
if (tpl) {
  try {
    state = JSON.parse(decodeEntities(tpl[1]));
  } catch (e) {
    parseError = e.message;
  }
}
const result = state?.vacancySearchResult;
const vacancies = result?.vacancies ?? [];

// Слово «captcha» встречается и на нормальной странице, поэтому смотрим на него только без InitialState
let verdict = 'OK';
if (status !== 200) verdict = `HTTP_${status}`;
else if (!tpl) verdict = /captcha|робот/i.test(html) ? 'CAPTCHA' : 'NO_STATE';
else if (parseError) verdict = 'PARSE_ERROR';
else if (vacancies.length === 0) verdict = 'EMPTY';

// Для шага 2 берём первую фронтенд-вакансию, иначе просто первую
const pick = vacancies.find((v) => /front|фронт|react/i.test(v.name)) ?? vacancies[0];

return [
  {
    json: {
      verdict,
      status,
      location: res.headers?.location ?? null,
      htmlLength: html.length,
      hasInitialState: Boolean(tpl),
      parseError,
      totalResults: result?.totalResults ?? null,
      vacanciesOnPage: vacancies.length,
      sample: vacancies
        .slice(0, 5)
        .map((v) => `${v.vacancyId} · ${v.name} · ${v.company?.visibleName ?? v.company?.name ?? ''}`),
      vacancyId: pick?.vacancyId ?? null,
      // Начало страницы — только если что-то не так, чтобы увидеть, что прислал hh
      htmlStart: verdict === 'OK' ? null : html.slice(0, 1000),
    },
  },
];
