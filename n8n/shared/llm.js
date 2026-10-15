// Нейросеть для разовых задач с JSON-схемой ответа: W11 — разбор резюме и правка профиля (13.10.2026), W13 —
// рекомендации по резюме (15.10.2026). Модель, тело запроса Gemini или Claude, разбор ответа.
// Общий код: строка «// @include n8n/shared/llm.js». Оценка W2 и письма W5 собирают запросы сами: свои температуры,
// схемы и seed.

// Модель: GEMINI_PROFILE_MODEL (запросов мало — можно взять модель посильнее), иначе та же, что для оценки
function llmModel(provider) {
  return provider === 'claude'
    ? $env.CLAUDE_MODEL || 'claude-haiku-4-5'
    : $env.GEMINI_PROFILE_MODEL || $env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
}

// Все поля обязательны: и Gemini, и Claude тогда возвращают полный объект
function strictSchema(schema) {
  if (schema.type === 'object') {
    const props = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, strictSchema(v)]));
    return { ...schema, properties: props, required: Object.keys(props), additionalProperties: false };
  }
  if (schema.type === 'array') return { ...schema, items: strictSchema(schema.items) };
  return schema;
}

// Gemini: типы заглавными, без additionalProperties, порядок полей — как в схеме
function geminiSchema(schema) {
  const out = { type: schema.type.toUpperCase() };
  if (schema.enum) out.enum = schema.enum;
  if (schema.type === 'object') {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, geminiSchema(v)]));
    out.required = Object.keys(schema.properties);
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.type === 'array') out.items = geminiSchema(schema.items);
  return out;
}

// Тело запроса к HTTP Request «Gemini» или «Claude». schema — JSON Schema в нижнем регистре, без required
function llmBody({ provider, model, system, user, schema, maxTokens = 4096, temperature = 0 }) {
  return provider === 'claude'
    ? {
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema: strictSchema(schema) } },
      }
    : {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json', responseSchema: geminiSchema(schema) },
      };
}

function llmBodyOf(r) {
  const b = r.body ?? r.data;
  if (typeof b !== 'string') return b ?? {};
  try {
    return JSON.parse(b);
  } catch {
    return { raw: b.slice(0, 300) };
  }
}

function llmText(provider, b) {
  if (provider === 'claude') {
    if (b.stop_reason === 'refusal') return { problem: 'нейросеть отказалась отвечать' };
    if (b.stop_reason === 'max_tokens') return { problem: 'ответ нейросети обрезан' };
    return { text: (b.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('') };
  }
  const cand = b.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return text ? { text } : { problem: `пустой ответ нейросети (${cand?.finishReason ?? b.promptFeedback?.blockReason ?? 'нет кандидатов'})` };
}

// Ответ HTTP Request (полный ответ, без исключений на 4xx/5xx) → { answer } — разобранный JSON, или { problem } — что
// показать человеку. retry — что делать при лимите (429)
function llmJson(res, provider, retry = 'попробуй ещё раз через минуту') {
  if (res.statusCode === undefined) return { problem: `нейросеть не ответила: ${String(res.error?.message ?? res.error ?? 'сеть').slice(0, 160)}` };
  const b = llmBodyOf(res);
  if (res.statusCode === 429) return { problem: `лимит запросов к нейросети (429) — ${retry}` };
  if (res.statusCode !== 200) {
    const message = String(b?.error?.message ?? b?.raw ?? '');
    // Gemini из неподдерживаемой страны (РФ и др.) — объясняем, а не показываем текст ошибки API
    if (/location is not supported/i.test(message)) return { problem: 'Gemini недоступен из твоей страны: нужна другая сеть или Claude (⚙️ → 🤖)' };
    return { problem: `нейросеть ответила HTTP ${res.statusCode}: ${message.slice(0, 160)}` };
  }
  const { text, problem } = llmText(provider, b);
  if (problem) return { problem };
  try {
    return { answer: JSON.parse(text) };
  } catch (e) {
    return { problem: `ответ нейросети не по схеме: ${e.message}`.slice(0, 200) };
  }
}
