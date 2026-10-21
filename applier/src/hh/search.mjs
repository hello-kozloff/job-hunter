// Подборка hh «по резюме» (21.10.2026): поиск /search/vacancy?resume=<хеш> работает только у вошедшего соискателя —
// анонимно hh параметр resume молча отбрасывает и отдаёт всю базу. Адреса строит W1 (n8n/shared/search.js), робот
// открывает их в своём окне и отдаёт выдачу как есть: вакансии разбирает W1 «Parse search».

export const SEARCH_MAX_URLS = 6;
const RESUME_HASH = /^[0-9a-f]{32,64}$/;

// Адрес подборки: только https://hh.ru/search/vacancy с resume=<хеш> — другие страницы по этому адресу робот не открывает
export function searchUrlOk(url) {
  let u;
  try {
    u = new URL(String(url ?? ''));
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.hostname === 'hh.ru' && u.pathname === '/search/vacancy' && RESUME_HASH.test(u.searchParams.get('resume') ?? '');
}

// Адреса из тела запроса → { urls } или { error }
export function cleanSearchUrls(urls) {
  if (!Array.isArray(urls) || !urls.length) return { error: 'нужны urls — адреса подборки hh по резюме' };
  if (urls.length > SEARCH_MAX_URLS) return { error: `не больше ${SEARCH_MAX_URLS} адресов` };
  const bad = urls.find((u) => !searchUrlOk(u));
  if (bad !== undefined) return { error: `не адрес подборки hh по резюме: ${String(bad).slice(0, 120)}` };
  return { urls: urls.map(String) };
}

// InitialState страницы поиска → { total, vacancies } | { error: layout | resume }. resume — hh подборку не применил
// (резюме не этого аккаунта или удалено): такая выдача — вся база hh, её не отдаём
export function searchResult(state) {
  const r = state?.vacancySearchResult;
  if (!r || !Array.isArray(r.vacancies)) return { error: 'layout' };
  if (!r.criteria?.resume) return { error: 'resume' };
  return { total: Number(r.totalResults) || 0, vacancies: r.vacancies };
}
