// Разовый догон (19.10.2026): что вернуть в обработку и что добавить из поиска hh за 30 дней.
// Команда — node scripts/n8n-api.mjs sweep [--days 30] [--no-search] [--resume] [--dry]; здесь — логика без сети и без n8n.
// --resume (21.10.2026) — подборка hh «по резюме» за --days дней: её читает робот, разбор — тот же «Parse search».
// Код Code-нод — те же файлы, что в n8n (W1 «Plan», «Parse search», «Filter search»), через песочницу тестов.
// Страницы вакансий открывает уже W1: строки new — его очередь «Pending new» → «Candidates» (хвост — до 25 за сбор).
import { runNode } from './sandbox.mjs';

// Причины со страницы вакансии (W1 «Parse vacancy»): фильтр по названию их не перепроверит — такие строки не трогаем.
// «AI не на JS/TS» правила больше нет (19.10.2026) — отсеянные им перепроверяются
export const PAGE_REASONS = ['в архиве', 'только из РФ', 'нет React и Vue'];
export const RETIRED_REASONS = ['AI не на JS/TS'];
export const SEARCH_PERIOD = 30;
export const MAX_PAGES = 20; // hh отдаёт не глубже 2000 вакансий
export const BACKLOG = 25; // W1 «Candidates»: хвост очереди за сбор

// «стоп-слово, только из РФ: «…»» → ['стоп-слово', 'только из РФ']
export const reasonKeys = (reasons) =>
  String(reasons ?? '')
    .split(', ')
    .filter(Boolean)
    .map((reason) => reason.replace(/:.*$/, ''));

// Адрес запроса W1 «Plan» → тот же запрос за period дней, страница page (page — последний параметр)
export const sweepUrl = (url, page, period = SEARCH_PERIOD) =>
  url.replace(/([?&])search_period=\d+/, `$1search_period=${period}`).replace(/([?&])page=\d+$/, `$1page=${page}`);

// Запросы поиска — как у W1 (активные резюме, удалёнка и офис в городе), страница 0
export async function searchPlan(settingsRows) {
  return runNode('n8n/w1-collector/plan.js', { nodes: { Settings: settingsRows } });
}

// Ответы hh по страницам → записи vacancies, как в W1 «Parse search»; pages — [{ item (из плана), page, res }]
export async function parsePages(pages) {
  const [out] = await runNode('n8n/w1-collector/parse-search.js', {
    nodes: { Plan: pages.map((p) => ({ ...p.item, page: p.page })), 'Search hh': pages.map((p) => p.res) },
  });
  return out;
}

// Подборка по резюме: адреса (как поле robot у W1 «Plan») и ответы робота по ним → записи с via = resume, как в W1
export async function parseRobot(robot, results) {
  const [out] = await runNode('n8n/w1-collector/parse-search.js', {
    nodes: { Plan: [{ label: '', page: 0, robot }], 'Search hh': [], 'Search resume': { statusCode: 200, body: { ok: true, results } } },
  });
  return out;
}

// Правила по выдаче (W1 «Filter search») с нынешними настройками и чёрным списком → строки со status и reasons
export async function filterRows(list, settingsRows, blacklistRows) {
  if (!list.length) return [];
  return runNode('n8n/w1-collector/filter-search.js', {
    nodes: { Settings: settingsRows, 'Is new': list, Blacklist: blacklistRows.length ? blacklistRows : [{}] },
  });
}

// Колонки строки, которые читает «Filter search»
const filterFields = (r) => ({
  external_id: r.external_id,
  title: r.title,
  company: r.company,
  company_id: r.company_id,
  experience: r.experience,
  responses: r.responses,
  resume_id: r.resume_id ?? '',
});

// План догона:
//   insert — новые для базы записи поиска (нет ни external_id, ни dup_key у строк, кроме seen) после фильтра;
//   requeue — id отсеянных за days дней без причин со страницы, которые нынешний фильтр пропускает;
//   seen — id строк бэкфилла: удалить (живые из них пришли в insert)
export async function planSweep({ rows, records = [], settingsRows, blacklistRows, days = SEARCH_PERIOD, now = Date.now() }) {
  const kept = rows.filter((r) => r.status !== 'seen');
  const ids = new Set(kept.map((r) => String(r.external_id)));
  const dups = new Set(kept.map((r) => r.dup_key));
  const fresh = records.filter((r) => !ids.has(String(r.external_id)) && !dups.has(r.dup_key));
  const insert = await filterRows(fresh, settingsRows, blacklistRows);

  const since = now - days * 24 * 3600 * 1000;
  const candidates = rows.filter(
    (r) =>
      r.status === 'rejected' &&
      (Date.parse(r.createdAt) || 0) >= since &&
      !reasonKeys(r.reasons).some((key) => PAGE_REASONS.includes(key)),
  );
  const filtered = await filterRows(candidates.map(filterFields), settingsRows, blacklistRows);
  const requeue = candidates
    .filter((r, i) => filtered[i].status === 'new')
    .map((r) => ({ id: r.id, title: r.title, company: r.company, was: r.reasons }));

  const seen = rows.filter((r) => r.status === 'seen');
  const back = new Set(insert.map((r) => String(r.external_id)));
  return {
    insert,
    requeue,
    seen: seen.map((r) => r.id),
    seenBack: seen.filter((r) => back.has(String(r.external_id))).length,
    queue: insert.filter((r) => r.status === 'new').length + requeue.length,
  };
}
