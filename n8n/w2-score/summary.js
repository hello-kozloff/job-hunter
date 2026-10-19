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
// Нейросеть не ответила (503 «высокий спрос», таймаут, сеть — 16.10.2026 Gemini делал так несколько раз за день): сбой
// временный, «Release» вернёт строки в очередь, и следующий запуск их оценит. Тревога со звуком — только если она не
// отвечает LLM_ALERT_AFTER запусков подряд; раньше — строка в тихом сообщении о сборе. Ошибка ключа или доступа,
// лимит 429 — по-прежнему сразу тревогой.
// Claude по подписке (19.10.2026, docs/claude-cli.md): оценки, которые сделал запасной Gemini (лимит подписки, окно
// занято, сбой), — тихой строкой в сообщении о сборе; лимит подписки без запасного Gemini — тоже тихо (пройдёт сам);
// вход слетел или нет токена — тревогой со звуком, но не чаще раза в сутки (static data cliAuthDay).

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

// Временные сбои нейросети и сколько запусков подряд она не отвечает (ни одной оценки): static data llmFails
const TRANSIENT = /^сеть:|^сервер нейросети: HTTP 5\d\d/;
const LLM_ALERT_AFTER = 3;
const retries = results.filter((r) => r.outcome === 'retry');
const transient = retries.filter((r) => TRANSIENT.test(r.problem));
if (scored.length) state.llmFails = 0;
else if (transient.length) state.llmFails = (state.llmFails ?? 0) + 1;
const llmFails = state.llmFails ?? 0;
const byProblem = (list) => {
  const groups = {};
  for (const r of list) groups[r.problem] = (groups[r.problem] ?? 0) + 1;
  return Object.entries(groups);
};
// Claude по подписке: кто оценил вместо него и почему (fallback от сервиса claude-cli), лимит без запасного Gemini
const viaGemini = scored.filter((r) => r.fallback);
const cliQuota = results.filter((r) => r.outcome === 'quota' && r.problem === 'cli');
const cliNotes = [
  ...Object.entries(
    viaGemini.reduce((groups, r) => ({ ...groups, [r.fallback.note]: (groups[r.fallback.note] ?? 0) + 1 }), {}),
  ).map(([note, n]) => `🤖 Claude по подписке: ${esc(note)}. Оценил Gemini: ${n}.`),
  ...(cliQuota.length ? [`⏸ ${esc(cliQuota[0].note || 'Claude по подписке: лимит')}. Не оценено ${cliQuota.length} — оценю после сброса.`] : []),
];
// Строка в тихом сообщении: сбой замечен, повторю сам
const llmNote = [
  ...byProblem(transient).map(([problem, n]) => `⚠️ Нейросеть: ${esc(problem)}. Не оценено ${n} — повторю в следующий запуск.`),
  ...cliNotes,
].join('\n');
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
  let quietSkips = 0;
  try {
    quietSkips = $('Quiet skips').all().length;
  } catch {
    // теневой режим включён — ветка не выполнялась
  }
  const text = `📊 Оценено ${scored.length}: ${parts.join(' · ')}${quietSkips ? `\n🔴 ${quietSkips} без карточек — теневой режим выключен, они в меню на вкладке ❌` : ''}${llmNote ? `\n${llmNote}` : ''}`;
  // Без звука: тихие часы (23:00–09:00 по местному) и итог с вакансиями без карточек. До 16.10.2026 тихие часы здесь
  // не работали: счётчик skip без карточек назывался quiet, как и тихие часы, и затенял их
  messages.push({ text: report ? `${report}\n\n${text}` : text, silent: quiet || quietSkips > 0, report: Boolean(report), live: false });
} else if (report) {
  messages.push({ text: llmNote ? `${report}\n\n${llmNote}` : report, silent: true, report: true, live: true });
}

// Тревоги
const alerts = [];
// Лимит Claude по подписке (problem cli) — тихой строкой выше: пройдёт сам после сброса
const quota = results.filter((r) => r.outcome === 'quota' && r.problem !== 'cli');
if (quota.length) {
  const provider = quota[0].llm_model?.startsWith('claude') ? 'Claude' : 'Gemini';
  const perDay = quota.some((r) => r.problem === 'day');
  // Gemini здесь — запасной путь Claude по подписке: переключать не на что, лимит подписки и так кончился
  const viaCli = quota.some((r) => r.fallback);
  alerts.push(
    `⚠️ ${provider}: ${perDay ? 'исчерпан дневной лимит запросов' : 'превышен лимит запросов в минуту'} (HTTP 429). ` +
      `Не оценено ${quota.length} — оценятся в следующий запуск.` +
      (perDay && provider === 'Gemini' && !viaCli
        ? '\nЕсли повторяется каждый день — переключить на Claude: ⚙️ Настройки → 🤖 Нейросеть (по подписке Pro/Max — CLAUDE_CODE_OAUTH_TOKEN в .env, docs/claude-cli.md; Claude API — ANTHROPIC_API_KEY).'
        : ''),
  );
}
// Вход Claude по подписке слетел или токена нет: оценки идут через запасной Gemini (или ждут), починить может только
// человек — громко, но раз в сутки
const cliAuth = results.find((r) => ['auth', 'notoken'].includes(r.fallback?.reason) || r.problem === 'cli-auth');
const today = new Date().toISOString().slice(0, 10);
if (cliAuth && state.cliAuthDay !== today) {
  state.cliAuthDay = today;
  const why = cliAuth.fallback?.note ?? String(cliAuth.note ?? '').replace(/^Claude по подписке:\s*/, '');
  alerts.push(
    `⚠️ Claude по подписке: ${esc(why)}. ${viaGemini.length ? 'Пока оценки и письма пишет Gemini.' : 'Оценки ждут.'}\n` +
      'Починка: в терминале <code>claude setup-token</code> → строка CLAUDE_CODE_OAUTH_TOKEN в .env → <code>scripts/deploy.sh</code> (docs/claude-cli.md).',
  );
}
// Нужно действие (ключ, доступ, неожиданный ответ) — сразу
for (const [problem, n] of byProblem(retries.filter((r) => !TRANSIENT.test(r.problem) && r.problem !== 'cli-auth'))) {
  alerts.push(`⚠️ Нейросеть: ${esc(problem)}. Не оценено ${n} — повторю в следующий запуск.`);
}
// Временный сбой не проходит: громко на LLM_ALERT_AFTER-м запуске подряд и потом раз в 8 запусков
if (transient.length && llmFails >= LLM_ALERT_AFTER && (llmFails - LLM_ALERT_AFTER) % 8 === 0) {
  const [[problem]] = byProblem(transient);
  alerts.push(
    `⚠️ Нейросеть не отвечает уже ${llmFails} запусков подряд: ${esc(problem)}. Не оценено ${transient.length} — оценю, когда ответит.\n` +
      'Если не проходит часами — ⚙️ Настройки → 🤖 Нейросеть.',
  );
}
const failed = sent.filter((s) => !s.result?.message_id);
if (failed.length) {
  alerts.push(`⚠️ Telegram: не отправлено карточек ${failed.length} — ${esc(failed[0].error ?? 'нет ответа')}. Повторю в следующий запуск.`);
}
if (alerts.length) messages.push({ text: alerts.join('\n\n'), silent: false, report: false, live: false });

return messages.map((m) => ({ json: m }));
