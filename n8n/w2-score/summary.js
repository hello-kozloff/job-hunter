// W2 · Summary — итог запуска: сводка (ночью без звука) и тревоги (всегда со звуком).
// Нода: Code, режим «Run Once for All Items». Выполняется после ветки карточек.
// Вход: «Parse verdict» — все вакансии запуска; «Send card» — ответы Telegram (если карточки отправлялись);
//       $input — «Recent rejects»: последние строки со status = rejected (W1 отсеял фильтром).
// Выход: 0–2 сообщения { text, silent } → «Send summary».

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const results = $('Parse verdict').all().map((i) => i.json);
let sent = [];
try {
  sent = $('Send card').all().map((i) => i.json);
} catch {
  // карточек в этом запуске не было — нода не выполнялась
}

const thaiHour = (new Date().getUTCHours() + 7) % 24;
const silent = thaiHour >= 23 || thaiHour < 9;
const messages = [];

// Сводка: решения нейросети + что отсеял фильтр W1 за последний запуск
// (W1 вызывает W2 сразу после сбора; сборы — не чаще раза в 30 мин → окно 15 мин)
const scored = results.filter((r) => r.outcome === 'scored');
if (scored.length) {
  const count = (d) => scored.filter((r) => r.decision === d).length;
  const parts = [`🟢 ${count('apply')}`, `🟡 ${count('maybe')}`, `🔴 ${count('skip')}`];
  if (count('error')) parts.push(`⚠️ ${count('error')}`);
  let text = `📊 Оценено ${scored.length}: ${parts.join(' · ')}`;

  const since = Date.now() - 15 * 60 * 1000;
  const rejects = $input
    .all()
    .map((i) => i.json)
    .filter((r) => r.status === 'rejected' && Date.parse(r.updatedAt) >= since);
  if (rejects.length) {
    const reasons = {};
    for (const r of rejects) {
      // «только из РФ: «цитата»» → «только из РФ»
      for (const reason of String(r.reasons).split(', ').filter(Boolean)) {
        const key = reason.replace(/:.*$/, '');
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
    }
    const list = Object.entries(reasons)
      .map(([k, n]) => `${esc(k)} ${n}`)
      .join(' · ');
    text += `\n🚫 Фильтр отсеял ${rejects.length}: ${list}`;
  }
  messages.push({ text, silent });
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
      (perDay && provider === 'Gemini' ? '\nЕсли повторяется каждый день — переключить на Claude: LLM_PROVIDER=claude в .env.' : ''),
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
if (alerts.length) messages.push({ text: alerts.join('\n\n'), silent: false });

return messages.map((m) => ({ json: m }));
