// Поисковый запрос hh.ru (CLAUDE.md §5): параметры страницы /search/vacancy.
// Общий код scripts/build-workflows.mjs (ноды «Search hh» в W0 и W1) и W1 «Score job»
// (сообщение о сборе): строка «// @include n8n/shared/search.js».

const SEARCH_URL = 'https://hh.ru/search/vacancy';
const SEARCH_QUERY = [
  // vue и nuxt — с 07.10.2026: Vue-вакансии без слов frontend/react в названии иначе не находятся
  ['text', 'NAME:(frontend OR front-end OR фронтенд OR react OR next.js OR nextjs OR typescript OR vue OR vue.js OR vuejs OR nuxt OR nuxt.js OR nuxtjs)'],
  ['professional_role', '96'],
  ['work_format', 'REMOTE'],
  ['education', 'not_required_or_not_specified'],
  ['order_by', 'publication_time'],
  ['items_on_page', '100'],
  ['enable_snippets', 'true'],
];

// Подписи параметров для сообщения о сборе, в порядке показа. Технические (items_on_page, enable_snippets) не показываем
const SEARCH_LABELS = {
  work_format: { REMOTE: 'удалёнка' },
  professional_role: { 96: 'программист, разработчик' },
  education: { not_required_or_not_specified: 'образование не важно' },
  order_by: { publication_time: 'сначала новые' },
};

// Ссылка на ту же выдачу на hh (page — с нуля, как в запросе)
const searchUrl = (page = 0) =>
  `${SEARCH_URL}?${[...SEARCH_QUERY, ['page', String(page)]]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')}`;

// Что искали, по-человечески: «в названии: frontend · react · …» и строка фильтров
function describeSearch() {
  const text = SEARCH_QUERY.find(([key]) => key === 'text')?.[1] ?? '';
  const words = text.match(/^NAME:\((.*)\)$/)?.[1].split(' OR ');
  const filters = Object.keys(SEARCH_LABELS).flatMap((key) =>
    SEARCH_QUERY.filter(([name]) => name === key).map(([, value]) => SEARCH_LABELS[key][value] ?? `${key}=${value}`),
  );
  return { words: words ? `в названии: ${words.join(' · ')}` : text, filters: filters.join(' · ') };
}
