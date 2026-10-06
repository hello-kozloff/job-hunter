// W0 · Check vacancy — проверка страницы вакансии hh.ru.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответ HTTP Request «Vacancy page» (Response Format = Text,
//       Include Response Headers and Status = on).
// Ищем два источника данных: JSON-LD JobPosting и HH-Lux-InitialState → vacancyView.vacancyFull.vacancy.

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

// JSON-LD лежит как есть, InitialState — с HTML-сущностями: пробуем оба варианта
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(decodeEntities(text));
    } catch {
      return null;
    }
  }
}

const ld =
  [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => parseJson(m[1]))
    .find((j) => j?.['@type'] === 'JobPosting') ?? null;

const tpl = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
const state = tpl ? parseJson(tpl[1]) : null;
const v = state?.vacancyView?.vacancyFull?.vacancy ?? null;
const test = v ? (state?.applicantVacancyResponseStatuses?.[String(v.vacancyId)]?.test ?? null) : null;

let verdict = 'OK';
if (status !== 200) verdict = `HTTP_${status}`;
else if (!v?.description && !ld?.description) verdict = !tpl && /captcha|робот/i.test(html) ? 'CAPTCHA' : 'NO_DATA';
else if (!v?.description) verdict = 'LD_ONLY';

return [
  {
    json: {
      verdict,
      status,
      jsonLd: ld
        ? {
            title: ld.title,
            company: ld.hiringOrganization?.name ?? null,
            datePosted: ld.datePosted ?? null,
            validThrough: ld.validThrough ?? null,
            descriptionLength: ld.description?.length ?? 0,
          }
        : null,
      initialState: v
        ? {
            vacancyId: v.vacancyId,
            name: v.name,
            company: v.company?.visibleName ?? v.company?.name ?? null,
            keySkills: v.keySkills ?? [],
            workExperience: v.workExperience ?? null,
            workFormats: v.workFormats ?? [],
            compensation: v.compensation ?? null,
            languages: v.languages ?? [],
            archived: v.status?.archived ?? null,
            country: v.area?.countryIsoCode ?? null,
            descriptionLength: v.description?.length ?? 0,
          }
        : null,
      test,
      htmlStart: verdict === 'OK' ? null : html.slice(0, 1000),
    },
  },
];
