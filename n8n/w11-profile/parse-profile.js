// W11 · Parse profile — ответ нейросети → проверенный черновик профиля (n8n/shared/profile.js → draftFromAnswer).
// Нода: Code, режим «Run Once for All Items».
// Вход: ответ HTTP Request «Gemini» или «Claude» (полный ответ, без исключений на 4xx/5xx), «Build extract»
//       (provider, mode), «Plan» (draft — прежний черновик при правке: город для офиса берётся из него).
// Выход: { ok: true, draft } или { ok: false, problem } — что показать человеку.

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

// @include n8n/shared/hh-roles.js

// @include n8n/shared/search.js

// @include n8n/shared/profile.js

const req = $('Build extract').first().json;
const plan = $('Plan').first().json;
const res = $input.first().json;

function bodyOf(r) {
  const b = r.body ?? r.data;
  if (typeof b !== 'string') return b ?? {};
  try {
    return JSON.parse(b);
  } catch {
    return { raw: b.slice(0, 300) };
  }
}
function answerText(provider, b) {
  if (provider === 'claude') {
    if (b.stop_reason === 'refusal') return { problem: 'нейросеть отказалась отвечать' };
    if (b.stop_reason === 'max_tokens') return { problem: 'ответ нейросети обрезан' };
    return { text: (b.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('') };
  }
  const cand = b.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return text ? { text } : { problem: `пустой ответ нейросети (${cand?.finishReason ?? b.promptFeedback?.blockReason ?? 'нет кандидатов'})` };
}

const fail = (problem) => [{ json: { ok: false, problem } }];
if (res.statusCode === undefined) return fail(`нейросеть не ответила: ${String(res.error?.message ?? res.error ?? 'сеть').slice(0, 160)}`);
const b = bodyOf(res);
if (res.statusCode === 429) return fail('лимит запросов к нейросети (429) — пришли PDF ещё раз через минуту');
if (res.statusCode !== 200) {
  const message = String(b?.error?.message ?? b?.raw ?? '');
  // Gemini из неподдерживаемой страны (РФ и др.) — объясняем, а не показываем текст ошибки API
  if (/location is not supported/i.test(message)) return fail('Gemini недоступен из твоей страны: нужна другая сеть или Claude (⚙️ → 🤖)');
  return fail(`нейросеть ответила HTTP ${res.statusCode}: ${message.slice(0, 160)}`);
}
const { text, problem } = answerText(req.provider, b);
if (problem) return fail(problem);
let answer;
try {
  answer = JSON.parse(text);
} catch (e) {
  return fail(`ответ нейросети не по схеме: ${e.message}`.slice(0, 200));
}
const draft = draftFromAnswer(answer, plan.draft ?? {});
if (draft.problem) return fail(draft.problem);
return [{ json: { ok: true, draft } }];
