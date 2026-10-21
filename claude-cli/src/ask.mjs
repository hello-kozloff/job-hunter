// Команды внутри контейнера: docker compose exec claude-cli node src/ask.mjs <команда>
//   state               предохранитель, загрузка окон подписки, дорожки, счётчики с запуска
//   check               один короткий настоящий вызов (Haiku 5.5, без запасного Gemini): вход и ответ по схеме
//   simulate <исход…>   следующие вызовы — как сбой CLI, без запуска: limit, auth, down, timeout, bad. limit и auth
//                       включают предохранитель (10 и 30 мин) — до него или до reset вызовы идут в запасной Gemini
//   reset               снять предохранитель и симуляцию
const BASE = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const [command, ...args] = process.argv.slice(2);

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  return { status: res.status, json: await res.json() };
}

const commands = {
  async state() {
    console.log(JSON.stringify((await api('GET', '/state')).json, null, 2));
  },
  async check() {
    const started = Date.now();
    const { status, json } = await api('POST', '/v1/messages', {
      model: 'claude-haiku-5-5',
      task: 'text',
      effort: 'low',
      deadline_ms: 120000,
      system: 'Ты проверяешь связь. Ответь строго по схеме.',
      messages: [{ role: 'user', content: 'Верни ok = true.' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } },
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (status === 200 && json.provider === 'claude-cli') {
      console.log(`✓ Claude по подписке отвечает: ${json.model}, ${seconds} с`);
      return;
    }
    console.log(`✗ ${json.error?.message ?? `Claude по подписке: HTTP ${status}`}`);
    process.exitCode = 1;
  },
  async simulate() {
    const { status, json } = await api('POST', '/simulate', { outcomes: args });
    console.log(JSON.stringify(json));
    if (status !== 200) process.exitCode = 1;
  },
  async reset() {
    await api('POST', '/reset', {});
    console.log('✓ предохранитель и симуляция сняты');
  },
};

if (!commands[command]) {
  console.error(`Команды: ${Object.keys(commands).join(', ')} (src/ask.mjs)`);
  process.exit(2);
}
await commands[command]().catch((e) => {
  console.error(`Сервис не отвечает на ${BASE}: ${e.message}`);
  process.exit(1);
});
