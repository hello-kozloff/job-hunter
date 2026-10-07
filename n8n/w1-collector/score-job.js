// W1 · Score job — задание для W2 Score: оценить вакансии сразу после сбора и сообщить о сборе.
// Нода: Code, режим «Run Once for All Items». Стоит ниже ветки вакансий: n8n (execution order v1)
// выполняет её последней, когда новые вакансии уже detailed.
// Выход: один item { report } → «Score» (Execute Workflow, без ожидания). W2 сам берёт строки detailed
// из таблицы, а без этой ноды в W2 ушёл бы весь результат поиска со 100 вакансиями.
// report — блок «🔎 Сбор» (HTML): запросы к hh, что искали, сколько новых и что отсеял фильтр, следующий сбор.
// W2 шлёт его одним живым сообщением без звука (прошлое удаляет) или ставит сверху итога «📊 Оценено»
// (решения пользователя 07.10.2026).

// @include n8n/shared/search.js

// @include n8n/shared/schedule.js

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Ноды ветки вакансий выполняются, только если в выдаче нашлись новые
const all = (name) => {
  try {
    return $(name)
      .all()
      .map((i) => i.json);
  } catch {
    return [];
  }
};
const plural = (n, one, few, many) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
};
// Время: по Таиланду (UTC+7), в скобках — по Москве (UTC+3), как в меню W7
const hhmm = (t, offset) => new Date(t + offset * 3600 * 1000).toISOString().slice(11, 16);
const thaiMsk = (t) => `${hhmm(t, 7)} (${hhmm(t, 3)} МСК)`;

const plan = $('Plan').first().json;
const search = $('Parse search').first().json;
const requests = search.requests ?? [];
const fresh = all('Filter search'); // новые: new | rejected, у бэкфилла seen
const parsed = all('Parse vacancy'); // прошли выдачу, страница открыта: detailed | rejected
const rejected = [...fresh, ...parsed].filter((r) => r.status === 'rejected');
const scoring = parsed.filter((r) => r.status === 'detailed').length;
const noPage = parsed.filter((r) => r.error).length;

// Запросы к hh: страницы поиска + страницы новых вакансий
const sent = requests.length + parsed.length;
let requestLine = `${sent} ${plural(sent, 'запрос', 'запроса', 'запросов')} к hh: поиск, ${requests
  .map((r) => `стр. ${r.page + 1} → ${r.status}`)
  .join(', ')}`;
if (parsed.length) {
  requestLine += ` · страницы вакансий: ${parsed.length}`;
  if (noPage) requestLine += ` (не открылись ${noPage} — оценка по фрагменту)`;
}

const onPages = requests.reduce((n, r) => n + (r.count ?? 0), 0);
const total = requests[0]?.total;
let result = 'все уже в базе';
if (search.firstRun) result = `первый запуск: ${fresh.length} записано без обработки (бэкфилл)`;
else if (fresh.length && !rejected.length) result = `новых ${fresh.length}, все на оценку`;
else if (fresh.length && !scoring) result = `новых ${fresh.length}, все отсеяны фильтром`;
else if (fresh.length) result = `новых ${fresh.length}: на оценку ${scoring}, отсеяно ${rejected.length}`;
const countLine =
  `${total != null ? `hh нашёл ${total}, ` : ''}на ${requests.length > 1 ? 'страницах' : 'странице'} ${onPages}, ` +
  `без дублей ${search.vacancies?.length ?? 0} — ${result}`;

// Отсеянные: название — ссылка на hh, причины. «только из РФ: «цитата»» показываем с цитатой — видно ложные срабатывания
const SHOW = 5;
const rejectedLines = rejected
  .slice(0, SHOW)
  .map((r) => `🚫 <a href="${esc(r.url)}">${esc(r.title)}</a> — ${esc(cut(String(r.reasons ?? ''), 120))}`);
if (rejected.length > SHOW) rejectedLines.push(`и ещё ${rejected.length - SHOW}`);

const { words, filters } = describeSearch();
const report = [
  `🔎 Сбор ${thaiMsk(plan.startedAt ?? Date.now())} · ${fresh.length ? `новых ${fresh.length}` : 'новых нет'}`,
  requestLine,
  countLine,
  ...rejectedLines,
  `<blockquote expandable>${esc(words)}\n${esc(filters)}</blockquote>`,
  `🔗 <a href="${esc(searchUrl(requests[0]?.page ?? 0))}">Открыть этот поиск на hh</a>`,
  `Следующий сбор ${thaiMsk(nextCollect(Date.now()))}`,
].join('\n');

return [{ json: { report } }];
