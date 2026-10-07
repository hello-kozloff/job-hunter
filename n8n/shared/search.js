// Поисковый запрос hh.ru (CLAUDE.md §5): параметры страницы /search/vacancy.
// Общий код scripts/build-workflows.mjs (ноды «Search hh» в W0 и W1) и W1 «Score job»
// (сообщение о сборе): строка «// @include n8n/shared/search.js».

const SEARCH_URL = 'https://hh.ru/search/vacancy';

// Слова поиска (решения пользователя 07.10.2026). frontend — по всему тексту вакансии: «JavaScript-разработчик»,
// fullstack и AI-вакансии с фронтендом в описании в названии слова frontend не несут; синонимы (фронтенд,
// front-end) hh подставляет сам. Стек и AI — только в названии: по всему тексту они приносят чужой бэкенд
// («React будет плюсом»). Замер за сутки: было 16 вакансий (всё в названии), стало 39
const SEARCH_ANYWHERE = ['frontend'];
const SEARCH_IN_NAME = [
  'react',
  'next.js',
  'nextjs',
  'vue',
  'vue.js',
  'vuejs',
  'nuxt',
  'nuxt.js',
  'nuxtjs',
  'typescript',
  // AI-разработка — тоже в работу (07.10.2026)
  'AI',
  'ИИ',
  'LLM',
  'GenAI',
  'GPT',
  'нейросети',
  'нейросетей',
];

const SEARCH_QUERY = [
  ['text', `${SEARCH_ANYWHERE.join(' OR ')} OR NAME:(${SEARCH_IN_NAME.join(' OR ')})`],
  ['professional_role', '96'],
  ['work_format', 'REMOTE'],
  ['education', 'not_required_or_not_specified'],
  // Только за сутки (решение пользователя 07.10.2026)
  ['search_period', '1'],
  ['order_by', 'publication_time'],
  ['items_on_page', '100'],
  ['enable_snippets', 'true'],
  // Как в выдаче на сайте; с одиночными значениями фильтров на результат не влияет
  ['ored_clusters', 'true'],
];

// Подписи параметров для сообщения о сборе, в порядке показа. Технические (items_on_page, enable_snippets,
// ored_clusters) не показываем
const SEARCH_LABELS = {
  work_format: { REMOTE: 'удалёнка' },
  professional_role: { 96: 'программист, разработчик' },
  education: { not_required_or_not_specified: 'образование не важно' },
  search_period: { 1: 'за сутки' },
  order_by: { publication_time: 'сначала новые' },
};

// Ссылка на ту же выдачу на hh (page — с нуля, как в запросе)
const searchUrl = (page = 0) =>
  `${SEARCH_URL}?${[...SEARCH_QUERY, ['page', String(page)]]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')}`;

// Что искали, по-человечески: где какие слова и строка фильтров
function describeSearch() {
  const filters = Object.keys(SEARCH_LABELS).flatMap((key) =>
    SEARCH_QUERY.filter(([name]) => name === key).map(([, value]) => SEARCH_LABELS[key][value] ?? `${key}=${value}`),
  );
  return {
    words: `везде в тексте: ${SEARCH_ANYWHERE.join(' · ')}\nв названии: ${SEARCH_IN_NAME.join(' · ')}`,
    filters: filters.join(' · '),
  };
}
