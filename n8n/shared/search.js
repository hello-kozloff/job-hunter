// Поисковый запрос hh.ru (CLAUDE.md §5): параметры страницы /search/vacancy.
// Слова, период, роли, формат, город и образование — из настроек (⚙️ → 🔎 Поиск, онбординг по резюме;
// n8n/shared/settings.js), остальное — здесь.
// Общий код scripts/build-workflows.mjs (W0 — запрос по умолчанию), W1 «Plan» (запросы сбора) и «Score job»
// (сообщение о сборе), W7 (⚙️ → 🔎 Поиск): строка «// @include n8n/shared/search.js» (после n8n/shared/settings.js;
// названия ролей — из n8n/shared/hh-roles.js, если он подключён раньше).

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
  return [...anywhere, ...(inName.length ? [`NAME:(${inName.join(' OR ')})`] : [])].join(' OR ');
}

// Параметры одного запроса: формат работы и город — свои у «удалёнки» и у «офиса» (searchQueries)
function searchParams(s, formats = s['search.formats'], areaId = null) {
  return [
    ['text', searchText(s)],
    ...s['search.roles'].map((id) => ['professional_role', String(id)]),
    ...formats.map((f) => ['work_format', f]),
    ...(areaId ? [['area', String(areaId)]] : []),
    ...s['search.education'].map((e) => ['education', e]),
    // Только за последние дни (решение пользователя 07.10.2026: за сутки)
    ['search_period', String(s['search.period'])],
    ['order_by', 'publication_time'],
    ['items_on_page', '100'],
    ['enable_snippets', 'true'],
    // Как в выдаче на сайте; с одиночными значениями фильтров на результат не влияет
    ['ored_clusters', 'true'],
  ];
}

// Запросы сбора (13.10.2026): удалёнка — по всем регионам, офис и гибрид — в городе из профиля (search.area).
// hh не умеет «удалёнка везде ИЛИ офис в городе» одним запросом, поэтому запросов до двух. Офис без города не ищем:
// по всем регионам это тысячи вакансий. [{ label, params }]; пусто — поиск не настроен
const FORMAT_NAMES = { REMOTE: 'удалёнка', HYBRID: 'гибрид', ON_SITE: 'офис', FIELD_WORK: 'разъездная' };
function searchQueries(s) {
  const formats = s['search.formats'];
  const office = formats.filter((f) => f !== 'REMOTE');
  const queries = [];
  if (formats.includes('REMOTE')) queries.push({ label: 'удалёнка', params: searchParams(s, ['REMOTE']) });
  if (office.length && s['search.area']) {
    queries.push({
      label: `${office.map((f) => FORMAT_NAMES[f]).join(' и ')}, ${s['search.area'].name}`,
      params: searchParams(s, office, s['search.area'].id),
    });
  }
  return queries;
}

// Подписи параметров для сообщения о сборе и настроек, в порядке показа. Технические (items_on_page,
// enable_snippets, ored_clusters) не показываем; роли и город — отдельно (searchFilters)
const SEARCH_LABELS = {
  work_format: FORMAT_NAMES,
  education: {
    not_required_or_not_specified: 'образование не требуется',
    special_secondary: 'среднее профессиональное',
    higher: 'высшее',
  },
  search_period: { 1: 'за сутки', 3: 'за 3 дня', 7: 'за неделю' },
  order_by: { publication_time: 'сначала новые' },
};
// Название роли hh: справочник n8n/shared/hh-roles.js, если подключён
const roleName = (id) => (typeof HH_ROLES === 'undefined' ? `роль ${id}` : (HH_ROLES[id] ?? `роль ${id}`)).toLowerCase();

// Ссылка на ту же выдачу на hh (page — с нуля, как в запросе); params — запрос из searchQueries (по умолчанию первый)
const searchUrl = (page, s, params = searchQueries(s)[0]?.params ?? searchParams(s)) =>
  `${SEARCH_URL}?${[...params, ['page', String(page)]]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')}`;

// Что искали, по-человечески: где какие слова и строка фильтров
function describeSearch(s) {
  const formats = s['search.formats'].map((f) => FORMAT_NAMES[f]);
  const filters = [
    `${formats.join(', ')}${s['search.area'] && s['search.formats'].some((f) => f !== 'REMOTE') ? ` (офис и гибрид — ${s['search.area'].name})` : ''}`,
    s['search.roles'].length ? s['search.roles'].map(roleName).join(', ') : 'все роли',
    ...s['search.education'].map((e) => SEARCH_LABELS.education[e] ?? e),
    SEARCH_LABELS.search_period[s['search.period']] ?? `за ${s['search.period']} дн.`,
    SEARCH_LABELS.order_by.publication_time,
  ];
  const words = [
    s['search.anywhere'].length && `везде в тексте: ${s['search.anywhere'].join(' · ')}`,
    s['search.in_name'].length && `в названии: ${s['search.in_name'].join(' · ')}`,
  ];
  return { words: words.filter(Boolean).join('\n'), filters: filters.join(' · ') };
}
