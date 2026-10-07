// W6 · Summary — утренняя сводка за сутки (10:00 по Таиланду = 06:00 МСК).
// Нода: Code, режим «Run Once for All Items». Выполняется последней (ветки выше — устаревшие и закрытые).
// Вход: «All rows» (таблица до правок этого запуска), «Plan», «Expire rows» / «Archive status» (если были),
//       «Executions» — запуски n8n из публичного API, $input — «Tunnel» (проверка туннеля ngrok).
// Выход: одно сообщение { text, silent }. Без звука, если сбоев нет (решение пользователя 07.10.2026).

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

// Теневой режим: оценки пользователя там, где решение нейросети известно
const shadow = rows.filter((r) => r.my_decision && ['apply', 'maybe', 'skip'].includes(r.decision));
const agree = count(shadow, (r) => r.my_decision === r.decision);

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
};
const executionsBody = $('Executions').first().json;
const executions = (executionsBody.data ?? []).filter((e) => at(e.startedAt) >= since);
const errors = executions.filter((e) => e.status === 'error' || e.status === 'crashed');
const errorsBy = {};
for (const e of errors) errorsBy[NAMES[e.workflowId] ?? e.workflowId] = (errorsBy[NAMES[e.workflowId] ?? e.workflowId] ?? 0) + 1;

// Сборы W1 по расписанию (МСК, держать в синхроне с Schedule W1 в scripts/build-workflows.mjs):
// днём 07:00–17:30 каждые 30 мин, ночью 18, 20, 22, 00, 02, 04, 06 — 29 в сутки.
// Окно — сутки до «сейчас − 10 мин»: сбор в 06:00 идёт одновременно со сводкой и ещё не закончился
const SLOT = 30 * 60 * 1000;
const isCollectSlot = (t) => {
  const msk = new Date(t + 3 * 3600 * 1000);
  const h = msk.getUTCHours();
  const m = msk.getUTCMinutes();
  return h >= 7 && h < 18 ? m % 30 === 0 : m === 0 && h % 2 === 0;
};
const windowEnd = now - 10 * 60 * 1000;
const windowStart = windowEnd - DAY;
let expected = 0;
for (let t = Math.floor(windowStart / SLOT) * SLOT + SLOT; t <= windowEnd; t += SLOT) if (isCollectSlot(t)) expected++;
const collected = count(
  executionsBody.data ?? [],
  (e) =>
    e.workflowId === 'jobHunterW1Colle' &&
    e.status === 'success' &&
    e.mode === 'trigger' &&
    at(e.startedAt) > windowStart &&
    at(e.startedAt) <= windowEnd,
);
// Ждут оценки дольше 30 мин: W2 запускается сразу после сбора, свежие строки detailed — норма
const pendingScore = count(rows, (r) => r.status === 'detailed' && at(r.createdAt) < now - 30 * 60 * 1000);
const tunnelCode = $input.first().json.statusCode;
const tunnelOk = !$env.NGROK_DOMAIN || tunnelCode === 403; // 403 = туннель жив, политика не пускает чужих

const problems = [];
if (executionsBody.error || !executionsBody.data) problems.push('нет данных о запусках n8n');
if (collected < expected) problems.push(`сборов ${collected} из ${expected}`);
if (errors.length)
  problems.push(
    `ошибок ${errors.length} (${Object.entries(errorsBy)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ')})`,
  );
if (!tunnelOk) problems.push(`туннель не отвечает (${tunnelCode ?? 'нет ответа'}) — кнопки не работают`);
if (pendingScore) problems.push(`ждут оценки нейросетью: ${pendingScore}`);

const date = new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10).split('-').reverse().slice(0, 2).join('.');
const lines = [
  `☀️ <b>Сводка за сутки</b> · ${date}`,
  `🔎 Новых вакансий: ${fresh.length} → фильтр отсеял ${rejected.length}${topReasons ? ` (${topReasons})` : ''}`,
  `🤖 Оценено: ${scored.length}${scored.length ? ` — 🟢 ${count(scored, (r) => r.decision === 'apply')} · 🟡 ${count(scored, (r) => r.decision === 'maybe')} · 🔴 ${count(scored, (r) => r.decision === 'skip')}` : ''}${count(scored, (r) => r.decision === 'error') ? ` · ⚠️ ${count(scored, (r) => r.decision === 'error')}` : ''}`,
  `👤 Твои решения: ✅ ${count(mine, (r) => r.my_decision === 'apply')} · 🤔 ${count(mine, (r) => r.my_decision === 'maybe')} · ❌ ${count(mine, (r) => r.my_decision === 'skip')} · 📨 отправлено ${sent}`,
  `⏳ Хвосты: без решения ${tailsWaiting} · ✅ без отклика ${tailsApproved}`,
  expired.size || archived.size ? `⌛ Устарели: ${expired.size} · 🔒 закрылись на hh: ${archived.size}` : '',
  shadow.length >= 50
    ? `🧪 Теневой режим: ${shadow.length}/50, совпало ${agree} (${Math.round((agree / shadow.length) * 100)}%) — пора разбирать, напиши Claude`
    : `🧪 Теневой режим: ${shadow.length}/50${shadow.length ? `, совпало ${agree} (${Math.round((agree / shadow.length) * 100)}%)` : ''}`,
  problems.length ? `⚠️ Сбои: ${problems.join(' · ')}` : `⚙️ Сборов ${collected} из ${expected}, ошибок нет, туннель работает`,
];

return [{ json: { text: lines.filter(Boolean).join('\n'), silent: problems.length === 0 } }];
