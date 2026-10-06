// Общий код разбора страницы вакансии hh: W1 «Parse vacancy» и W6 «Archive status».
// В Code-ноду попадает строкой «// @include n8n/shared/hh.js».

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

// Ответ HTTP Request «Vacancy page» → { v: vacancyFull.vacancy, test } или { error, statusCode }
function parsePage(res) {
  const html = String(res.data ?? res.body ?? '');
  if (res.statusCode !== 200) return { error: `страница: HTTP ${res.statusCode}`, statusCode: res.statusCode };
  const tpl = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
  if (!tpl) return { error: 'страница: нет HH-Lux-InitialState' };
  try {
    const state = JSON.parse(decodeEntities(tpl[1]));
    const v = state?.vacancyView?.vacancyFull?.vacancy;
    if (!v?.description) return { error: 'страница: нет описания' };
    return { v, test: state?.applicantVacancyResponseStatuses?.[String(v.vacancyId)]?.test };
  } catch (e) {
    return { error: `страница: ${e.message}` };
  }
}
