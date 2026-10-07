// W2 · Parse verdict — ответ нейросети → решение по вакансии.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы HTTP Request «Gemini» или «Claude» (полный ответ, Never Error; при сетевой ошибке
//       или таймауте нода отдаёт { error }). В одном запуске работает один провайдер, поэтому
//       ответы сопоставляются с items «Build prompt» по порядку.
// Выход: строка вакансии + decision, llm_reason, llm_model и outcome:
//   scored — решение есть. decision = error, если ответ пустой или не по схеме: карточка с ⚠️, решает пользователь;
//   quota  — HTTP 429, лимит запросов: «Release» вернёт строку в detailed, она оценится в следующий запуск;
//   retry  — 5xx, таймаут, ошибка ключа или доступа: «Release» вернёт строку в detailed, problem → тревога в «Summary».

const prompts = $('Build prompt').all().map((i) => i.json);
const rows = new Map($('Claim').all().map((i) => [i.json.id, i.json]));
const DECISIONS = new Set(['apply', 'maybe', 'skip']);

function bodyOf(res) {
  const b = res.body ?? res.data;
  if (typeof b !== 'string') return b ?? {};
  try {
    return JSON.parse(b);
  } catch {
    return { raw: b.slice(0, 300) };
  }
}

const apiError = (b) => String(b?.error?.message ?? b?.error?.type ?? b?.raw ?? '').slice(0, 300);

// Текст ответа модели или описание, почему его нет
function answerText(provider, b) {
  if (provider === 'claude') {
    if (b.stop_reason === 'refusal') return { problem: 'модель отказалась отвечать' };
    if (b.stop_reason === 'max_tokens') return { problem: 'ответ обрезан по max_tokens' };
    return { text: (b.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('') };
  }
  const cand = b.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (text) return { text };
  return { problem: `пустой ответ (${cand?.finishReason ?? b.promptFeedback?.blockReason ?? 'нет кандидатов'})` };
}

return $input.all().map((item, i) => {
  const prompt = prompts[i];
  const base = { ...rows.get(prompt.id), llm_model: prompt.model, prompt_v: prompt.prompt_v };
  const res = item.json;
  const code = res.statusCode;

  if (code === undefined) {
    const message = res.error?.message ?? res.error ?? 'нет ответа';
    return { json: { ...base, outcome: 'retry', problem: `сеть: ${String(message).slice(0, 200)}` } };
  }
  const b = bodyOf(res);
  if (code === 429) {
    // Gemini пишет в деталях, какой лимит кончился: …PerDay… или …PerMinute…
    const perDay = /PerDay/i.test(JSON.stringify(b));
    return { json: { ...base, outcome: 'quota', problem: perDay ? 'day' : 'minute' } };
  }
  if (code >= 500) return { json: { ...base, outcome: 'retry', problem: `сервер нейросети: HTTP ${code}` } };
  if (code !== 200) return { json: { ...base, outcome: 'retry', problem: `HTTP ${code}: ${apiError(b)}` } };

  const { text, problem } = answerText(prompt.provider, b);
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
