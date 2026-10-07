// W7 · Render — панель меню бота: список вакансий, карточка, статистика или приветствие с кнопками меню.
// Нода: Code, режим «Run Once for All Items».
// Вход: «Job» — что показать (view = list | open | stats | start); «Rows» — вся таблица vacancies;
//       $input — «Executions»: последние запуски W1 из публичного API n8n (для статистики).
// Выход: { route, view, layout, edit, chatId, messageId, text, b, deleteIds, tab, page }
//   route — выход «Layout» (Switch): раскладка × отправить новое сообщение (чётный) / править панель (нечётный),
//           10 — приветствие с кнопками под полем ввода;
//   b — подписи и callback_data кнопок: раскладки фиксированные (Telegram-нода не умеет менять число кнопок);
//   deleteIds — что удалить после отправки: нажатие пользователя и прошлую панель (одна живая панель в чате).
// Static data (global): panel = { messageId, view, id, tab, page } — текущая панель: что на ней (list | open | stats,
//                       id — открытая вакансия) и вкладка, куда вернут «⬅️ К списку» и «📋 К вакансиям»;
//                       greetingId — приветствие (при новом /start старое удаляется).

// @include n8n/shared/card.js
// @include n8n/shared/menu.js
// @include n8n/shared/schedule.js

const job = $('Job').first().json;
const rows = $('Rows')
  .all()
  .map((i) => i.json)
  .filter((r) => r.id);
const executions = $input.first().json;
const state = $getWorkflowStaticData('global');
const panel = state.panel ?? {};

const now = Date.now();
const DAY = 24 * 3600 * 1000;
const PAGE = 8;
const LAYOUTS = ['list', 'open_choose', 'open_decided', 'open_plain', 'stats'];
const chatId = String(job.chatId || $env.TG_CHAT_ID);
// sync — после «📨 Отправил» / «↩️ Отменить» под письмом (W3 «Sync job»): перерисовать панель,
// только если на ней открыта эта вакансия — иначе на ней нечего обновлять
if (job.view === 'sync' && !(panel.view === 'open' && Number(panel.id) === Number(job.id) && panel.messageId)) {
  return [];
}
// Кнопка в панели, перерисовка после решения, sync — правим панель; кнопка меню, /v…, «📋 К вакансиям» — новая
const target = job.view === 'sync' ? panel.messageId : job.messageId;
const edit = Boolean(target);
const at = (s) => Date.parse(s) || 0;
const count = (list, f) => list.filter(f).length;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Время: по Таиланду (UTC+7), в скобках — по Москве (UTC+3)
const hhmm = (t, offset) => new Date(t + offset * 3600 * 1000).toISOString().slice(11, 16);
const thaiMsk = (t) => `${hhmm(t, 7)} (${hhmm(t, 3)} МСК)`;
function span(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'меньше минуты';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return h < 3 && m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
  return `${Math.floor(h / 24)} д`;
}

// ---------- Список ----------

const inTab = (key) => {
  const statuses = TABS[key].statuses;
  return rows.filter((r) => (statuses ? statuses.includes(r.status) : r.status !== 'seen'));
};
const counts = Object.fromEntries(Object.keys(TABS).map((key) => [key, inTab(key).length]));

function itemLines(r, n) {
  const icons = `${VERDICT_ICON[r.decision] ?? ''}${STATUS_ICON[r.status] ?? ''}`;
  const age = now - at(r.createdAt);
  const meta = [
    esc(r.company),
    r.status === 'rejected' ? `🚫 ${esc(String(r.reasons ?? '').split(', ')[0].replace(/:.*$/, ''))}` : salary(r),
    r.status === 'applied' && r.applied_at
      ? `📨 ${thaiDate(r.applied_at)}`
      : age < DAY
        ? `${span(age)} назад`
        : thaiDate(r.createdAt),
    `/v${r.id}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return `${n}. ${icons} <a href="${r.url}">${esc(r.title)}</a>\n   ${meta}`;
}

function listView(tabKey, pageNo, note = '') {
  const tab = TABS[tabKey] ? tabKey : counts.wait ? 'wait' : 'all';
  const items = inTab(tab).sort((a, b) => (tab === 'sent' ? at(b.applied_at) - at(a.applied_at) : 0) || b.id - a.id);
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const page = Math.min(Math.max(1, Number(pageNo) || 1), pages);
  const lines = items.slice((page - 1) * PAGE, page * PAGE).map((r, i) => itemLines(r, (page - 1) * PAGE + i + 1));
  const { icon, name } = TABS[tab];
  const head = `📋 <b>Вакансии</b> · ${icon} ${name} — ${items.length}${pages > 1 ? ` · стр. ${page}/${pages}` : ''}`;
  const off = { text: '·', cb: 'p:x' };
  return {
    layout: 'list',
    tab,
    page,
    text: `${[note, head].filter(Boolean).join('\n')}\n\n${lines.length ? lines.join('\n') : 'Здесь пока пусто.'}`,
    b: {
      tabs: Object.keys(TABS).map((key) => ({
        text: `${key === tab ? '• ' : ''}${TABS[key].icon} ${counts[key]}`,
        cb: `p:l:${key}:1`,
      })),
      prev: page > 1 ? { text: '◀️', cb: `p:l:${tab}:${page - 1}` } : off,
      // Номер страницы — обновить её (новые вакансии, решения)
      mid: { text: `${page}/${pages}`, cb: `p:l:${tab}:${page}` },
      next: page < pages ? { text: '▶️', cb: `p:l:${tab}:${page + 1}` } : off,
    },
  };
}

// ---------- Карточка на панели ----------

function openView(id) {
  // Вкладка для «⬅️ К списку»: из кнопки панели (pv:…), а для /v… — та, что сейчас открыта на панели
  const fromJob = Boolean(TABS[job.tab]);
  const tab = fromJob ? job.tab : TABS[panel.tab] ? panel.tab : 'all';
  const page = Number(fromJob ? job.page : panel.page) || 1;
  const r = rows.find((x) => x.id === id);
  if (!r) return listView(tab, page, `⚠️ Вакансии /v${id} нет в базе`);

  const extra = [
    r.status === 'rejected' && `🚫 Отсеяна фильтром: ${esc(r.reasons)}`,
    ['new', 'detailed'].includes(r.status) && '⚙️ Ждёт оценки нейросетью',
    r.status === 'seen' && '🗄 Из первой выгрузки — не оценивалась',
    r.letter && r.status === 'approved' && '✉️ Письмо готово — в ленте под карточкой',
  ].filter(Boolean);
  // Строка «🤖 …» пустая, если нейросеть вакансию не оценивала (отсеяна фильтром, бэкфилл)
  const card = cardText(r)
    .split('\n')
    .filter((line) => line !== '🤖 ')
    .join('\n');

  // Кнопки решения — только если есть исходная карточка в ленте: решение правит и её (W3, callback pv:…)
  let layout = 'open_plain';
  if (r.tg_message_id && (r.status === 'waiting' || job.choose)) layout = 'open_choose';
  else if (r.tg_message_id && ['approved', 'maybe', 'skipped'].includes(r.status)) layout = 'open_decided';

  const choice = (c) => `pv:${r.id}:${c}:${tab}:${page}`;
  return {
    layout,
    tab,
    page,
    text: [`🔎 <b>Вакансия</b> /v${r.id}`, '', card, ...extra].join('\n'),
    b: {
      apply: choice('apply'),
      maybe: choice('maybe'),
      skip: choice('skip'),
      edit: choice('edit'),
      url: r.url,
      back: `p:l:${tab}:${page}`,
    },
  };
}

// ---------- Статистика ----------

function statsView() {
  const runs = (executions.data ?? [])
    .filter((e) => e.workflowId === 'jobHunterW1Colle')
    .sort((a, b) => at(b.startedAt) - at(a.startedAt));
  const last = runs[0];
  const next = nextCollect(now);

  // За сутки — как в утренней сводке W6: окно до «сейчас − 10 мин», только запуски по расписанию
  const windowEnd = now - 10 * 60 * 1000;
  const windowStart = windowEnd - DAY;
  const expected = countCollectSlots(windowStart, windowEnd);
  const collected = count(
    runs,
    (e) => e.status === 'success' && e.mode === 'trigger' && at(e.startedAt) > windowStart && at(e.startedAt) <= windowEnd,
  );

  let lastLine = '• последний: нет данных — API n8n не ответил';
  if (last) {
    const started = at(last.startedAt);
    const stopped = at(last.stoppedAt) || now;
    const fresh = count(
      rows,
      (r) => r.status !== 'seen' && at(r.createdAt) >= started - 5000 && at(r.createdAt) <= stopped + 60000,
    );
    const result =
      last.status === 'success'
        ? `✅ новых ${fresh}`
        : ['error', 'crashed'].includes(last.status)
          ? '⚠️ ошибка'
          : '⏳ идёт';
    lastLine = `• последний: ${thaiMsk(started)}, ${span(now - started)} назад — ${result}`;
  } else if (executions.data) {
    lastLine = '• последний: запусков ещё не было';
  }

  const found = rows.filter((r) => r.status !== 'seen');
  const scored = rows.filter((r) => ['apply', 'maybe', 'skip', 'error'].includes(r.decision));
  const cards = rows.filter((r) => r.tg_message_id);
  const reviewed = count(cards, (r) => r.my_decision);
  const waiting = rows.filter((r) => r.status === 'waiting');
  const oldest = Math.min(...waiting.map((r) => at(r.card_at || r.createdAt)));
  const status = (s) => count(rows, (r) => r.status === s);
  const shadow = rows.filter((r) => r.my_decision && ['apply', 'maybe', 'skip'].includes(r.decision));
  const agree = count(shadow, (r) => r.my_decision === r.decision);
  const errors = count(scored, (r) => r.decision === 'error');

  const lines = [
    `📊 <b>Статистика</b> · ${hhmm(now, 7)} по Таиланду`,
    '',
    '🔎 <b>Сбор</b> · днём раз в 30 мин, ночью раз в 2 ч',
    lastLine,
    `• следующий: ${thaiMsk(next)}, через ${span(next - now)}`,
    executions.data ? `• за сутки: ${collected} из ${expected} по расписанию` : '',
    '',
    `📥 <b>Вакансии</b>: найдено ${found.length}, за сутки +${count(found, (r) => at(r.createdAt) >= now - DAY)}`,
    `• 🚫 отсеяно фильтром: ${status('rejected')} · ⚙️ ждут нейросети: ${status('new') + status('detailed')}`,
    `• 🤖 оценено ${scored.length}: 🟢 ${count(scored, (r) => r.decision === 'apply')} · 🟡 ${count(scored, (r) => r.decision === 'maybe')} · 🔴 ${count(scored, (r) => r.decision === 'skip')}${errors ? ` · ⚠️ ${errors}` : ''}`,
    '',
    `👤 <b>Рассмотрено тобой</b>: ${reviewed} из ${cards.length} (${pct(reviewed, cards.length)}%)`,
    `• ⏳ ждут решения: ${waiting.length}${waiting.length ? `, старейшая — ${span(now - oldest)}` : ''}`,
    `• ✅ ${status('approved')} · 🤔 ${status('maybe')} · ❌ ${status('skipped')} · 📨 отправлено ${status('applied')}`,
    `• ⌛ устарели ${status('expired')} · 🔒 закрылись ${status('archived')}`,
    '',
    `🧪 Теневой режим: ${shadow.length}/50${shadow.length ? `, совпало ${agree} (${pct(agree, shadow.length)}%)` : ''}`,
  ];
  return {
    layout: 'stats',
    tab: panel.tab,
    page: panel.page,
    text: lines.filter((line, i) => line !== '' || lines[i - 1] !== '').join('\n'),
    b: { wait: { text: `⏳ Ждут решения · ${counts.wait}`, cb: 'p:l:wait:1' } },
  };
}

// ---------- Приветствие ----------

const GREETING = [
  '👋 <b>Меню бота</b> — кнопки под полем ввода:',
  '',
  `${MENU.list} — база по вкладкам: ⏳ ждут решения · ✅ откликнусь и 🤔 · 📨 отправлено · ❌ мимо · 🚫 отсеяно фильтром · 📋 все. ` +
    'Команда вида <code>/v169</code> в строке открывает карточку — решение можно принять прямо там.',
  `${MENU.stats} — когда был и будет сбор, сколько вакансий рассмотрено.`,
  '',
  'Новые вакансии по-прежнему приходят карточками.',
].join('\n');

// ---------- Выбор вида ----------

if (job.view === 'start') {
  return [
    {
      json: {
        route: 10,
        view: 'start',
        layout: 'start',
        edit: false,
        chatId,
        messageId: 0,
        text: GREETING,
        b: {},
        deleteIds: [job.userMessageId, state.greetingId].filter(Boolean),
      },
    },
  ];
}

const view = ['open', 'sync'].includes(job.view)
  ? openView(Number(job.id))
  : job.view === 'stats'
    ? statsView()
    : // resume — «📋 К вакансиям»: та вкладка и страница, что была на панели
      listView(job.resume ? panel.tab : job.tab, job.resume ? panel.page : job.page);
const shown = view.layout.startsWith('open') ? 'open' : view.layout;
const id = shown === 'open' ? Number(job.id) : 0;

// Панель, которую правим, становится текущей: «⬅️ К списку», /v… и «📋 К вакансиям» вернут на её вкладку
if (edit) {
  state.panel = { messageId: target, view: shown, id, tab: view.tab ?? panel.tab, page: view.page ?? panel.page };
}

return [
  {
    json: {
      route: LAYOUTS.indexOf(view.layout) * 2 + (edit ? 1 : 0),
      view: shown,
      id,
      layout: view.layout,
      edit,
      chatId,
      messageId: target || 0,
      text: view.text,
      b: view.b,
      deleteIds: edit ? [] : [job.userMessageId, panel.messageId].filter(Boolean),
      tab: view.tab ?? '',
      page: view.page ?? 1,
    },
  },
];
