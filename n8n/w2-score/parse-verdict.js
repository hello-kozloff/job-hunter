// W2 · Parse verdict — ответ нейросети → решение по вакансии.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы HTTP Request «Gemini», «Claude» или «Claude CLI» (полный ответ, Never Error; при сетевой ошибке
//       или таймауте нода отдаёт { error }). В одном запуске работает один провайдер, поэтому
//       ответы сопоставляются с items «Build prompt» по порядку.
// Выход: строка вакансии + decision, llm_reason, llm_model и outcome:
//   scored — решение есть. decision = error, если ответ пустой или не по схеме: карточка с ⚠️, решает пользователь;
//   quota  — HTTP 429, лимит запросов: «Release» вернёт строку в detailed, она оценится в следующий запуск;
//   retry  — 5xx, таймаут, ошибка ключа или доступа: «Release» вернёт строку в detailed, problem → тревога в «Summary».
// Claude по подписке (19.10.2026, docs/claude-cli.md): сервис отвечает в форме Claude API или сырым ответом запасного
// Gemini — llm_model тогда модель, которая ответила на самом деле, а fallback ({ reason, until, note }) — почему не
// Claude: «Summary» пишет тихую строку, «вход слетел» — тревогой раз в сутки. В таблицу fallback не попадает: строки
// для записи собирают «Card sent», «Quiet skips», «First save» по полям.

// @include n8n/shared/llm.js

const prompts = $('Build prompt').all().map((i) => i.json);
const rows = new Map($('Claim').all().map((i) => [i.json.id, i.json]));
const DECISIONS = new Set(['apply', 'maybe', 'skip']);

const apiError = (b) => String(b?.error?.message ?? b?.error?.type ?? b?.raw ?? '').slice(0, 300);

return $input.all().map((item, i) => {
  const prompt = prompts[i];
  const res = item.json;
  const code = res.statusCode;
  const b = code === undefined ? {} : llmBodyOf(res);
  const viaCli = prompt.provider === 'claude-cli';
  const fallback = viaCli && b.fallback ? b.fallback : null;
  const base = {
    ...rows.get(prompt.id),
    llm_model: viaCli ? b.model || prompt.model : prompt.model,
    prompt_v: prompt.prompt_v,
    ...(fallback && { fallback }),
  };

  if (code === undefined) {
    const message = res.error?.message ?? res.error ?? 'нет ответа';
    const where = viaCli ? 'сервис Claude по подписке (claude-cli) не отвечает — ' : '';
    return { json: { ...base, outcome: 'retry', problem: `сеть: ${where}${String(message).slice(0, 200)}` } };
  }
  // Ошибка самого Claude по подписке — запасного Gemini не было (нет ключа или сервис не успел)
  const cliError = viaCli && b.provider !== 'gemini' && code !== 200;
  if (code === 429) {
    if (cliError) return { json: { ...base, outcome: 'quota', problem: 'cli', note: String(b.error?.message ?? '') } };
    // Gemini пишет в деталях, какой лимит кончился: …PerDay… или …PerMinute…
    const perDay = /PerDay/i.test(JSON.stringify(b));
    return { json: { ...base, outcome: 'quota', problem: perDay ? 'day' : 'minute' } };
  }
  if (cliError && code === 401) return { json: { ...base, outcome: 'retry', problem: 'cli-auth', note: String(b.error?.message ?? '') } };
  if (code >= 500) return { json: { ...base, outcome: 'retry', problem: `сервер нейросети: HTTP ${code}` } };
  if (code !== 200) return { json: { ...base, outcome: 'retry', problem: `HTTP ${code}: ${apiError(b)}` } };

  const { text, problem } = llmText(llmProvider(prompt.provider, b), b);
  if (problem) return { json: { ...base, outcome: 'scored', decision: 'error', llm_reason: problem } };
  try {
    const verdict = JSON.parse(text);
    if (!DECISIONS.has(verdict.decision)) throw new Error(`decision = ${verdict.decision}`);
    return {
      json: {
        ...base,
        outcome: 'scored',
        decision: verdict.decision,
        llm_reason: String(verdict.reason ?? '').trim().slice(0, 300),
      },
    };
  } catch (e) {
    return { json: { ...base, outcome: 'scored', decision: 'error', llm_reason: `ответ не по схеме: ${e.message}`.slice(0, 300) } };
  }
});
