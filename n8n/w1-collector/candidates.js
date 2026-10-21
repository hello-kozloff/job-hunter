// W1 · Candidates — каким строкам открыть страницу вакансии (19.10.2026).
// Нода: Code, режим «Run Once for All Items».
// Вход: «Pending new» — все строки vacancies со status = new: только что вставленные этим сбором (прошли фильтр по
// выдаче) и хвост прошлых — сбор упал посреди страниц вакансий или строки вернул разовый догон
// (node scripts/n8n-api.mjs sweep). Раньше страницы открывались только у строк этого сбора, и упавший сбор оставлял
// строки new навсегда.
// Выход: строки этого сбора — все, как раньше (первый поиск после онбординга не меняется); хвост — не больше BACKLOG
// за сбор, сначала свежие публикации: hh не получает сотню запросов разом, карточки приходят порциями.
// Дальше «Vacancy page» → «Parse vacancy» (строки отсюда, в порядке ответов) → «Update».

const BACKLOG = 25;
// «Filter search» выполняется, только если в выдаче нашлись новые
const all = (name) => {
  try {
    return $(name)
      .all()
      .map((i) => i.json);
  } catch {
    return [];
  }
};
const fresh = new Set(
  all('Filter search')
    .filter((r) => r.status === 'new')
    .map((r) => r.external_id),
);
const rows = $input
  .all()
  .map((i) => i.json)
  .filter((r) => r.id && r.status === 'new');
const now = rows.filter((r) => fresh.has(r.external_id));
const queue = rows
  .filter((r) => !fresh.has(r.external_id))
  .sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0) || b.id - a.id)
  .slice(0, BACKLOG);
return [...now, ...queue].map((json) => ({ json }));
