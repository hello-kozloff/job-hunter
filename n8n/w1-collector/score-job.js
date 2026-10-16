// W1 · Score job — задание для W2 Score: оценить вакансии сразу после сбора и сообщить о сборе.
// Нода: Code, режим «Run Once for All Items». Стоит ниже ветки вакансий: n8n (execution order v1)
// выполняет её последней, когда новые вакансии уже detailed.
// Выход: один item { report, runId, run } → «Finish run» (итог в журнал runs) и «Score» (Execute Workflow,
// без ожидания). W2 сам берёт строки detailed из таблицы, а без этой ноды в W2 ушёл бы весь результат поиска
// со 100 вакансиями; по runId W2 допишет в журнал число карточек.
// report — блок «🔎 Сбор» (HTML): запросы к hh, что искали, сколько новых и что отсеял фильтр, следующий сбор.
// W2 шлёт его одним живым сообщением без звука (прошлое удаляет) или ставит сверху итога «📊 Оценено»
// (решения пользователя 07.10.2026).

// @include n8n/shared/time.js

// @include n8n/shared/settings.js

// @include n8n/shared/hh-roles.js

// @include n8n/shared/search.js

// @include n8n/shared/resumes.js

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
// Время: по местному, в скобках — по Москве, как в меню W7 (n8n/shared/time.js)

const plan = $('Plan').first().json;
const search = $('Parse search').first().json;
const requests = search.requests ?? [];
const fresh = all('Filter search'); // новые: new | rejected
const parsed = all('Parse vacancy'); // прошли выдачу, страница открыта: detailed | rejected
const rejected = [...fresh, ...parsed].filter((r) => r.status === 'rejected');
const scoring = parsed.filter((r) => r.status === 'detailed').length;
const noPage = parsed.filter((r) => r.error).length;

// Запросы к hh: страницы поиска + страницы новых вакансий
const sent = requests.length + parsed.length;
let requestLine = `${sent} ${plural(sent, 'запрос', 'запроса', 'запросов')} к hh: поиск, ${requests
  .map((r) => `${requests.length > 1 && r.label ? `${r.label} ` : ''}стр. ${r.page + 1} → ${r.status}`)
  .join(', ')}`;
if (parsed.length) {
  requestLine += ` · страницы вакансий: ${parsed.length}`;
  if (noPage) requestLine += ` (не открылись ${noPage} — оценка по фрагменту)`;
}

const settings = loadSettings($('Settings').all());
const onPages = requests.reduce((n, r) => n + (r.count ?? 0), 0);
// Нашёл hh — по каждому запросу (удалёнка и офис в городе считаются отдельно)
const totals = requests.filter((r) => r.total != null);
const total = totals.length ? totals.reduce((n, r) => n + r.total, 0) : null;
// Поиск за сутки (search_period=1): обычно всё найденное умещается на одной странице
const period = SEARCH_LABELS.search_period[settings['search.period']];
let result = 'все уже в базе';
if (fresh.length && !rejected.length) result = `новых ${fresh.length}, все на оценку`;
else if (fresh.length && !scoring) result = `новых ${fresh.length}, все отсеяны фильтром`;
else if (fresh.length) result = `новых ${fresh.length}: на оценку ${scoring}, отсеяно ${rejected.length}`;
const countLine = [
  total != null
    ? `hh нашёл${period ? ` ${period}` : ''} ${totals.length > 1 ? totals.map((r) => `${r.label} ${r.total}`).join(' + ') : total}`
    : '',
  total == null || onPages < total ? `на ${requests.length > 1 ? 'страницах' : 'странице'} ${onPages}` : '',
  `без дублей ${search.vacancies?.length ?? 0} — ${result}`,
]
  .filter(Boolean)
  .join(', ');

// Отсеянные: название — ссылка на hh, причины. «только из РФ: «цитата»» показываем с цитатой — видно ложные срабатывания
const SHOW = 5;
const rejectedLines = rejected
  .slice(0, SHOW)
  .map((r) => `🚫 <a href="${esc(r.url)}">${esc(r.title)}</a> — ${esc(cut(String(r.reasons ?? ''), 120))}`);
if (rejected.length > SHOW) rejectedLines.push(`и ещё ${rejected.length - SHOW}`);

// Что искали — по каждому резюме (при нескольких — с названием резюме)
const several = resumeList(settings).length > 1;
const searched = activeResumes(settings)
  .slice(0, MAX_SEARCH_RESUMES)
  .map((r) => ({ r, rs: resumeSettings(settings, r.id) }));
const searchedText = searched
  .map(({ r, rs }) => {
    const { words, filters } = describeSearch(rs);
    return `${several ? `📄 ${esc(r.name)}\n` : ''}${esc(words)}\n${esc(filters)}`;
  })
  .join('\n\n');
// Одинаковые адреса (как в «Plan») — одна ссылка, у первого резюме
const seenLinks = new Set();
const searchLinks = searched.flatMap(({ r, rs }) =>
  searchQueries(rs).flatMap((q, i, list) => {
    const url = searchUrl(0, rs, q.params);
    if (seenLinks.has(url)) return [];
    seenLinks.add(url);
    const what = list.length > 1 ? `поиск «${esc(q.label)}»` : 'этот поиск';
    return [`🔗 <a href="${esc(url)}">Открыть ${what}${several ? ` (${esc(r.name)})` : ''} на hh</a>`];
  }),
);
// Расписание — из настроек бота (⚙️ → 🕐 Сбор)
const next = nextCollect(Date.now(), scheduleFrom(settings));
const report = [
  `🔎 Сбор ${localMsk(plan.startedAt ?? Date.now())} · ${fresh.length ? `новых ${fresh.length}` : 'новых нет'}`,
  requestLine,
  countLine,
  ...rejectedLines,
  `<blockquote expandable>${searchedText}</blockquote>`,
  ...searchLinks,
  next ? `Следующий сбор ${localMsk(next)}` : '⏸ Сбор на паузе — дальше только «🔄 Собрать сейчас» в ⚙️ Настройках',
].join('\n');

// Журнал сборов: запись из «Start run» и итог сбора
const run = {
  found: total ?? null,
  uniq: search.vacancies?.length ?? 0,
  fresh: fresh.length,
  rejected: rejected.length,
  scoring,
  pages: parsed.length,
};

return [{ json: { report, runId: $('Start run').first().json.id, run } }];
