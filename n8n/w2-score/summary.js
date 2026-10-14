// W2 · Summary — сообщения после запуска: о сборе, итог оценки (ночью без звука) и тревоги (всегда со звуком).
// Нода: Code, режим «Run Once for All Items». Своя ветка от триггера, ниже ветки карточек: n8n (execution
// order v1) выполняет её последней — и тогда, когда оценивать было нечего (ветка карточек встала на «Pending»).
// Вход: $input — item триггера: от W1 { report } — блок «🔎 Сбор» (n8n/w1-collector/score-job.js),
//       у ручного запуска пустой; «Parse verdict» — все вакансии запуска; «Send card» — ответы Telegram
//       (обе ноды выполняются, только если были вакансии на оценку).
// Выход: 0–2 сообщения { text, silent, report, live } → «Send summary» → «Live report» (решения пользователя 07.10.2026):
//   были оценки — «🔎 Сбор» сверху итога «📊 Оценено N» (live = false — остаётся в чате);
//   оценок нет  — «🔎 Сбор» одним живым сообщением без звука (live = true — следующее сообщение о сборе его заменит);
//   тревоги     — отдельным сообщением.

// @include n8n/shared/time.js

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const all = (name) => {
  try {
    return $(name)
      .all()
      .map((i) => i.json);
  } catch {
    return []; // нода в этом запуске не выполнялась
  }
};

const report = String($input.first()?.json?.report ?? '');
const results = all('Parse verdict');
const sent = all('Send card');

const quiet = quietHours();
const messages = [];

// Первый поиск после онбординга (profile.first_quiet, 14.10.2026): без карточек и без блока «🔎 Сбор» — одно живое
// сообщение с прогрессом и итог в конце. Оценки копятся в static data (first)
// Флаг — из «Quiet flag» (своя ветка выше: «Settings» не выполняется, если оценивать нечего)
const firstQuiet = all('Quiet flag').some((r) => r.name === 'profile.first_quiet' && r.value_json === 'true');
const claimed = all('Claim').length;

// Итог оценки; что отсеял фильтр W1 — в блоке «🔎 Сбор»
const scored = results.filter((r) => r.outcome === 'scored');
const state = $getWorkflowStaticData('global');
if (firstQuiet) {
  const f = (state.first ??= { apply: 0, maybe: 0, skip: 0, n: 0 });
  for (const r of scored) {
    f.n += 1;
    if (f[r.decision] !== undefined) f[r.decision] += 1;
  }
  // Pending берёт до 40 за запуск: полная пачка — вероятно, есть ещё; меньше — это была последняя
  if (claimed >= 40) {
    messages.push({ text: `⏳ Идёт первый поиск: оценено ${f.n}, продолжаю… Карточки по одной не шлю — пришлю итог.`, silent: true, report: true, live: true, again: true });
  } else {
    // Захвачены, но не сохранены (429, 503 и т. п.) — «Release» (ветка ниже) вернёт их в очередь
    const left = claimed - all('First save').length - all('Quiet skips').length;
    messages.push({
      text: [
        `✅ <b>Первый поиск готов</b>: оценено ${f.n} — 🟢 ${f.apply} подходят · 🟡 ${f.maybe} спорно · 🔴 ${f.skip} мимо.`,
        left ? `Ещё ${left} не успел оценить (ошибка нейросети) — оценю в следующие сборы.` : '',
        'Все вакансии — в 📋 Вакансии → ⏳ Ждут решения. Дальше новые будут приходить карточками.',
      ]
        .filter(Boolean)
        .join('\n'),
      silent: false,
      report: true,
      live: false,
      done: true,
    });
    delete state.first;
  }
} else if (scored.length) {
  const count = (d) => scored.filter((r) => r.decision === d).length;
  const parts = [`🟢 ${count('apply')}`, `🟡 ${count('maybe')}`, `🔴 ${count('skip')}`];
  if (count('error')) parts.push(`⚠️ ${count('error')}`);
  // Теневой режим выключен — skip без карточек (W2 «Quiet skips»)
  let quiet = 0;
  try {
    quiet = $('Quiet skips').all().length;
  } catch {
    // теневой режим включён — ветка не выполнялась
  }
  const text = `📊 Оценено ${scored.length}: ${parts.join(' · ')}${quiet ? `\n🔴 ${quiet} без карточек — теневой режим выключен, они в меню на вкладке ❌` : ''}`;
  messages.push({ text: report ? `${report}\n\n${text}` : text, silent: quiet, report: Boolean(report), live: false });
} else if (report) {
  messages.push({ text: report, silent: true, report: true, live: true });
}

// Тревоги
const alerts = [];
const quota = results.filter((r) => r.outcome === 'quota');
if (quota.length) {
  const provider = quota[0].llm_model?.startsWith('claude') ? 'Claude' : 'Gemini';
  const perDay = quota.some((r) => r.problem === 'day');
  alerts.push(
    `⚠️ ${provider}: ${perDay ? 'исчерпан дневной лимит запросов' : 'превышен лимит запросов в минуту'} (HTTP 429). ` +
      `Не оценено ${quota.length} — оценятся в следующий запуск.` +
      (perDay && provider === 'Gemini' ? '\nЕсли повторяется каждый день — переключить на Claude: ⚙️ Настройки → 🤖 Нейросеть (нужен ANTHROPIC_API_KEY в .env).' : ''),
  );
}
const problems = {};
for (const r of results.filter((x) => x.outcome === 'retry')) problems[r.problem] = (problems[r.problem] ?? 0) + 1;
for (const [problem, n] of Object.entries(problems)) {
  alerts.push(`⚠️ Нейросеть: ${esc(problem)}. Не оценено ${n} — повторю в следующий запуск.`);
}
const failed = sent.filter((s) => !s.result?.message_id);
if (failed.length) {
  alerts.push(`⚠️ Telegram: не отправлено карточек ${failed.length} — ${esc(failed[0].error ?? 'нет ответа')}. Повторю в следующий запуск.`);
}
if (alerts.length) messages.push({ text: alerts.join('\n\n'), silent: false, report: false, live: false });

return messages.map((m) => ({ json: m }));
