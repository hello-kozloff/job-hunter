// Поисковый запрос hh.ru (CLAUDE.md §5): параметры страницы /search/vacancy.
// Слова и период — из настроек бота (⚙️ → 🔎 Поиск, n8n/shared/settings.js), остальное — здесь.
// Общий код scripts/build-workflows.mjs (W0 — запрос по умолчанию), W1 «Plan» (запрос сбора) и «Score job»
// (сообщение о сборе): строка «// @include n8n/shared/search.js» (после n8n/shared/settings.js).

const SEARCH_URL = 'https://hh.ru/search/vacancy';

// Решения пользователя 07.10.2026: frontend — по всему тексту вакансии («JavaScript-разработчик», fullstack и
// AI-вакансии с фронтендом в описании в названии слова frontend не несут; синонимы фронтенд и front-end hh
// подставляет сам). Стек и AI — только в названии: по всему тексту они приносят чужой бэкенд («React будет плюсом»).
// Замер за сутки: было 16 вакансий (всё в названии), стало 39

// Слово с пробелом — в кавычках, иначе язык запросов hh разобьёт его на два
const searchTerm = (w) => (w.includes(' ') ? `"${w}"` : w);

function searchText(s) {
  const anywhere = s['search.anywhere'].map(searchTerm);
  const inName = s['search.in_name'].map(searchTerm);
  return [...anywhere, `NAME:(${inName.join(' OR ')})`].join(' OR ');
}

function searchQuery(s) {
  return [
    ['text', searchText(s)],
    ['professional_role', '96'],
    ['work_format', 'REMOTE'],
    ['education', 'not_required_or_not_specified'],
    // Только за последние дни (решение пользователя 07.10.2026: за сутки)
    ['search_period', String(s['search.period'])],
    ['order_by', 'publication_time'],
    ['items_on_page', '100'],
    ['enable_snippets', 'true'],
    // Как в выдаче на сайте; с одиночными значениями фильтров на результат не влияет
    ['ored_clusters', 'true'],
  ];
}

// Подписи параметров для сообщения о сборе и настроек, в порядке показа. Технические (items_on_page,
// enable_snippets, ored_clusters) не показываем
const SEARCH_LABELS = {
  work_format: { REMOTE: 'удалёнка' },
  professional_role: { 96: 'программист, разработчик' },
  education: { not_required_or_not_specified: 'образование не важно' },
  search_period: { 1: 'за сутки', 3: 'за 3 дня', 7: 'за неделю' },
  order_by: { publication_time: 'сначала новые' },
};

// Ссылка на ту же выдачу на hh (page — с нуля, как в запросе)
const searchUrl = (page, s) =>
  `${SEARCH_URL}?${[...searchQuery(s), ['page', String(page)]]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')}`;

// Что искали, по-человечески: где какие слова и строка фильтров
function describeSearch(s) {
  const query = searchQuery(s);
  const filters = Object.keys(SEARCH_LABELS).flatMap((key) =>
    query.filter(([name]) => name === key).map(([, value]) => SEARCH_LABELS[key][value] ?? `${key}=${value}`),
  );
  return {
    words: `везде в тексте: ${s['search.anywhere'].join(' · ')}\nв названии: ${s['search.in_name'].join(' · ')}`,
    filters: filters.join(' · '),
  };
}
