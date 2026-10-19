// Нейросеть для разовых задач с JSON-схемой ответа: W11 — разбор резюме и правка профиля (13.10.2026), W13 —
// рекомендации по резюме (15.10.2026). Модель, тело запроса Gemini, Claude API или Claude по подписке, разбор ответа.
// Общий код: строка «// @include n8n/shared/llm.js». Оценка W2 и письма W5 собирают тела запросов сами (свои
// температуры, схемы и seed), отсюда берут cliBody (Claude по подписке) и чтение ответа (llmBodyOf, llmProvider, llmText).

// Модель: GEMINI_PROFILE_MODEL (запросов мало — можно взять модель посильнее), иначе та же, что для оценки.
// Claude по подписке — модель текстов из настроек бота (⚙️ → 🤖, llm.cli_text)
function llmModel(provider, settings = {}) {
  if (provider === 'claude-cli') return settings['llm.cli_text'] || 'claude-sonnet-5-5';
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

// Claude по подписке (сервис claude-cli, docs/claude-cli.md): тело Claude API + задача (дорожка и бюджет сервиса:
// score — оценка W2, text — тексты), усилие, сколько ждёт n8n (таймаут ноды «Claude CLI» минус запас) и запасной
// запрос Gemini — тот же, что ушёл бы при llm.provider = gemini. Его сервис шлёт, если лимит подписки кончился или
// вход слетел. temperature и max_tokens CLI не задаёт — сервис их не читает
const CLI_EFFORT = 'low';
const CLI_WAIT_MS = 170000;
function cliBody(claude, { task, fallback, deadlineMs = CLI_WAIT_MS }) {
  return { ...claude, task, effort: CLI_EFFORT, deadline_ms: deadlineMs, fallback };
}

// Тело запроса к HTTP Request «Gemini», «Claude» или «Claude CLI». schema — JSON Schema в нижнем регистре, без required.
// deadlineMs — только для Claude по подписке: W13 ждёт дольше (правка резюме)
function llmBody({ provider, model, system, user, schema, maxTokens = 4096, temperature = 0, settings, deadlineMs }) {
  const claude = () => ({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: strictSchema(schema) } },
  });
  const gemini = () => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json', responseSchema: geminiSchema(schema) },
  });
  if (provider === 'claude-cli') return cliBody(claude(), { task: 'text', fallback: { model: llmModel('gemini', settings), body: gemini() }, deadlineMs });
  return provider === 'claude' ? claude() : gemini();
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

// Кто ответил: сервис Claude по подписке отвечает в форме Claude API (ответил Claude) или сырым ответом Gemini
// (запасной путь, provider: 'gemini'). Остальные провайдеры — как есть
const llmProvider = (provider, b) => (provider === 'claude-cli' ? (b?.provider === 'gemini' ? 'gemini' : 'claude') : provider);

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
  if (res.statusCode === undefined) {
    const message = String(res.error?.message ?? res.error ?? 'сеть').slice(0, 160);
    if (provider === 'claude-cli') return { problem: `сервис Claude по подписке не отвечает (${message}) — scripts/deploy.sh` };
    return { problem: `нейросеть не ответила: ${message}` };
  }
  const b = llmBodyOf(res);
  // Ошибка самого Claude по подписке (запасного Gemini не было): текст сервиса уже по-русски — «Claude по подписке: …»
  if (provider === 'claude-cli' && b.provider !== 'gemini' && res.statusCode !== 200) {
    return { problem: `${String(b?.error?.message ?? `Claude по подписке: HTTP ${res.statusCode}`).slice(0, 200)} — ${retry}` };
  }
  if (res.statusCode === 429) return { problem: `лимит запросов к нейросети (429) — ${retry}` };
  if (res.statusCode !== 200) {
    const message = String(b?.error?.message ?? b?.raw ?? '');
    // Gemini из неподдерживаемой страны (РФ и др.) — объясняем, а не показываем текст ошибки API
    if (/location is not supported/i.test(message)) return { problem: 'Gemini недоступен из твоей страны: нужна другая сеть или Claude (⚙️ → 🤖)' };
    return { problem: `нейросеть ответила HTTP ${res.statusCode}: ${message.slice(0, 160)}` };
  }
  const { text, problem } = llmText(llmProvider(provider, b), b);
  if (problem) return { problem };
  try {
    return { answer: JSON.parse(text) };
  } catch (e) {
    return { problem: `ответ нейросети не по схеме: ${e.message}`.slice(0, 200) };
  }
}
