// W6 · Summary — утренняя сводка за сутки: в 10:00 по местному её запускают «часы» W8 (13.10.2026).
// Нода: Code, режим «Run Once for All Items». Выполняется последней (ветки выше — устаревшие и закрытые).
// Вход: «All rows» (таблица до правок этого запуска), «Plan», «Expire rows» / «Archive status» (если были),
//       «Runs» — журнал сборов W1, «Executions» — запуски n8n из публичного API (ошибки),
//       «Robot health» — GET /health робота-отклика (этап 6), $input — «Tunnel» (проверка туннеля ngrok).
// Выход: одно сообщение { text, silent }. Без звука, если сбоев нет (решение пользователя 07.10.2026).

// @include n8n/shared/time.js

// @include n8n/shared/shadow.js

// @include n8n/shared/settings.js

// @include n8n/shared/schedule.js

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const from = (name) => {
  try {
    return $(name).all().map((i) => i.json);
  } catch {
    return []; // ветка не выполнялась: устаревших или закрытых не было
  }
};

const DAY = 24 * 3600 * 1000;
const now = Date.now();
const since = now - DAY;
const at = (s) => Date.parse(s) || 0;
const rows = $('All rows').all().map((i) => i.json).filter((r) => r.id);
const settings = loadSettings($('Settings').all());
const expired = new Set(from('Expire rows').map((r) => r.id));
const archived = new Set(from('Archive status').map((r) => r.id));

// Воронка: новые строки за сутки (кроме бэкфилла seen) → отсеяно фильтром → оценено нейросетью
const fresh = rows.filter((r) => at(r.createdAt) >= since && r.status !== 'seen');
const rejected = fresh.filter((r) => r.status === 'rejected');
const reasons = {};
for (const r of rejected) {
  for (const reason of String(r.reasons).split(', ').filter(Boolean)) {
    const key = reason.replace(/:.*$/, '');
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
}
const topReasons = Object.entries(reasons)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 4)
  .map(([k, n]) => `${esc(k)} ${n}`)
  .join(' · ');
// Время оценки — card_at (пишет W2); у строк до этапа 5 его нет — берём время создания
const scored = rows.filter((r) => r.decision && at(r.card_at || r.createdAt) >= since);
const count = (list, f) => list.filter(f).length;

// Решения пользователя за сутки (по времени последнего изменения строки) и отправленные отклики
const mine = rows.filter((r) => r.my_decision && at(r.updatedAt) >= since);
const sent = count(rows, (r) => at(r.applied_at) >= since);

// Хвосты после этого запуска
const tailsWaiting = count(rows, (r) => r.status === 'waiting' && !expired.has(r.id) && !archived.has(r.id));
const tailsApproved = count(rows, (r) => r.status === 'approved' && !archived.has(r.id));

// Теневой режим: оценки пользователя там, где решение нейросети известно, — с метки «🔄 Теневой заново»
// (n8n/shared/shadow.js)
const shadow = shadowStats(rows, settings['llm.shadow_since']);

// Сбои: запуски n8n за сутки (публичный API), туннель, хвост оценки нейросетью
const NAMES = {
  jobHunterS0Setup: 'S0 таблицы',
  jobHunterS1TgTst: 'S1 тест Telegram',
  jobHunterW0Check: 'W0 проверка hh',
  jobHunterW4Error: 'W4 тревоги',
  jobHunterW1Colle: 'W1 сбор',
  jobHunterW2Score: 'W2 оценка',
  jobHunterW3Teleg: 'W3 кнопки',
  jobHunterW5Lettr: 'W5 письма',
  jobHunterW6Summ1: 'W6 сводка',
  jobHunterW7Menu1: 'W7 меню',
  jobHunterW8Clock: 'W8 часы',
  jobHunterW9Robot: 'W9 робот',
  jobHunterW10Inbx: 'W10 входящие',
};
const executionsBody = $('Executions').first().json;
const executions = (executionsBody.data ?? []).filter((e) => at(e.startedAt) >= since);
const errors = executions.filter((e) => e.status === 'error' || e.status === 'crashed');
const errorsBy = {};
for (const e of errors) errorsBy[NAMES[e.workflowId] ?? e.workflowId] = (errorsBy[NAMES[e.workflowId] ?? e.workflowId] ?? 0) + 1;

// Сборы W1 по расписанию — журнал runs (сколько положено — n8n/shared/schedule.js). Окно — сутки
// до «сейчас − 10 мин»: сбор в 06:00 идёт одновременно со сводкой и ещё не закончился
const windowEnd = now - 10 * 60 * 1000;
const windowStart = windowEnd - DAY;
// Расписание — из настроек бота (⚙️ → 🕐 Сбор). На паузе сборов не ждём — и не тревожим
const sch = scheduleFrom(settings);
const expected = countCollectSlots(windowStart, windowEnd, sch);
const collected = count(
  $('Runs')
    .all()
    .map((i) => i.json),
  (r) =>
    ['schedule', 'catchup'].includes(r.kind) &&
    r.status === 'ok' &&
    at(r.started_at) > windowStart &&
    at(r.started_at) <= windowEnd,
);
// Ждут оценки дольше 30 мин: W2 запускается сразу после сбора, свежие строки detailed — норма
// (scoring — W2 сейчас оценивает; застрявшие в scoring вернёт ветка «Unstick»). Время — когда строка стала detailed
// (updatedAt), а не создана: строки из очереди и разового догона создавались давно (19.10.2026)
const pendingScore = count(
  rows,
  (r) => ['detailed', 'scoring'].includes(r.status) && at(r.updatedAt) < now - 30 * 60 * 1000,
);
const tunnelCode = $input.first().json.statusCode;
const tunnelOk = !$env.NGROK_DOMAIN || tunnelCode === 403; // 403 = туннель жив, политика не пускает чужих

const problems = [];
if (executionsBody.error || !executionsBody.data) problems.push('нет данных о запусках n8n');
if (!sch.paused && collected < expected) problems.push(`сборов ${collected} из ${expected}`);
if (errors.length)
  problems.push(
    `ошибок ${errors.length} (${Object.entries(errorsBy)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ')})`,
  );
if (!tunnelOk) problems.push(`туннель не отвечает (${tunnelCode ?? 'нет ответа'}) — кнопки не работают`);
if (pendingScore) problems.push(`ждут оценки нейросетью: ${pendingScore}`);

// Робот-отклик (этап 6): отклики за сутки и его здоровье — если он включён в ⚙️. Автоотклик (6.1c): сколько из них
// робот взял сам (🤖), сколько ты убрал из очереди (⛔) и к скольким письмо не вышло. Время попытки — apply_at
// (у строк до 20.10.2026 его нет — по updatedAt)
const robotOn = settings['apply.enabled'];
const tried = (r) => (at(r.apply_at) || at(r.updatedAt)) >= since;
const robotRows = rows.filter((r) => r.apply_by === 'robot' && at(r.applied_at) >= since);
const robotAuto = count(robotRows, (r) => r.apply_mode === 'auto');
const robotManual = count(rows, (r) => ['test', 'external', 'hidden'].includes(r.apply_result) && tried(r));
const robotErrors = count(rows, (r) => r.apply_result === 'error' && r.status === 'approved' && tried(r));
const robotStopped = count(rows, (r) => r.apply_result === 'stopped' && at(r.apply_at) >= since);
const robotNoLetter = count(rows, (r) => r.apply_result === 'no_letter' && at(r.apply_at) >= since);
const robotQueue = count(rows, (r) => r.apply_state);
const robotLineText =
  robotOn || robotRows.length || robotQueue
    ? `🚀 Робот: ${robotRows.length}${robotRows.length ? ` (${robotAuto ? `🤖 авто ${robotAuto} · ` : ''}✉️ ${count(robotRows, (r) => r.apply_letter === 'attached')} · 💬 ${count(robotRows, (r) => r.apply_letter === 'chat')})` : ''}${robotManual ? ` · 🧩 вручную ${robotManual}` : ''}${robotErrors ? ` · ⚠️ ${robotErrors}` : ''}${robotStopped ? ` · ⛔ убрал ${robotStopped}` : ''}${robotNoLetter ? ` · ✉️ письмо не вышло ${robotNoLetter}` : ''}${robotQueue ? ` · в очереди ${robotQueue}` : ''}${settings['apply.paused'] ? ' · ⏸ пауза' : ''}${settings['apply.enabled'] && settings['apply.auto'] ? ' · 🤖 автоотклик вкл' : ''}`
    : '';
if (robotOn) {
  const h = $('Robot health').first()?.json ?? {};
  if (!h.ok || h.error) problems.push('робот-отклик не отвечает');
  else if (h.blocked) problems.push(`робот ждёт (${h.blocked.kind}) с ${localHM(at(h.blocked.since))}`);
  else if (!h.loggedIn) problems.push('робот не вошёл в hh');
}

const date = localDM(now);
const lines = [
  `☀️ <b>Сводка за сутки</b> · ${date}`,
  `🔎 Новых вакансий: ${fresh.length} → фильтр отсеял ${rejected.length}${topReasons ? ` (${topReasons})` : ''}`,
  `🤖 Оценено: ${scored.length}${scored.length ? ` — 🟢 ${count(scored, (r) => r.decision === 'apply')} · 🟡 ${count(scored, (r) => r.decision === 'maybe')} · 🔴 ${count(scored, (r) => r.decision === 'skip')}` : ''}${count(scored, (r) => r.decision === 'error') ? ` · ⚠️ ${count(scored, (r) => r.decision === 'error')}` : ''}`,
  `👤 Твои решения: ✅ ${count(mine, (r) => r.my_decision === 'apply')} · 🤔 ${count(mine, (r) => r.my_decision === 'maybe')} · ❌ ${count(mine, (r) => r.my_decision === 'skip')} · 📨 отправлено ${sent}${count(mine, (r) => r.my_decision === 'earlier') ? ` · 📨 раньше ${count(mine, (r) => r.my_decision === 'earlier')}` : ''}`,
  robotLineText,
  `⏳ Хвосты: без решения ${tailsWaiting} · ✅ без отклика ${tailsApproved}`,
  expired.size || archived.size ? `⌛ Устарели: ${expired.size} · 🔒 закрылись на hh: ${archived.size}` : '',
  shadow.pairs >= SHADOW_GOAL ? `${shadowLine(shadow)} — пора разбирать, напиши Claude` : shadowLine(shadow),
  sch.paused ? '⏸ Сбор на паузе (⚙️ Настройки → 🕐 Сбор)' : '',
  problems.length
    ? `⚠️ Сбои: ${problems.join(' · ')}`
    : `⚙️ Сборов ${collected}${sch.paused ? '' : ` из ${expected}`}, ошибок нет, туннель работает`,
];

return [{ json: { text: lines.filter(Boolean).join('\n'), silent: problems.length === 0 } }];
