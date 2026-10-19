// Обработчик запроса n8n: предохранитель, дорожки, ответ в форме Claude API, переход на Gemini. claude и Gemini
// подменены. Запуск: cd claude-cli && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBreaker } from '../src/limits.mjs';
import { createLanes } from '../src/lanes.mjs';
import { createGemini } from '../src/gemini.mjs';
import { createHandler, parseRequest } from '../src/handler.mjs';

const GEMINI_BODY = { contents: [{ role: 'user', parts: [{ text: 'вакансия' }] }], generationConfig: { temperature: 0 } };
const body = (extra = {}) => ({
  model: 'claude-haiku-5-5',
  max_tokens: 1024,
  temperature: 0,
  system: 'правила',
  messages: [{ role: 'user', content: 'вакансия' }],
  output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
  task: 'score',
  effort: 'low',
  deadline_ms: 170000,
  fallback: { model: 'gemini-3.5-flash-lite', body: GEMINI_BODY },
  ...extra,
});
const OK = { kind: 'ok', model: 'claude-haiku-5-5', json: { decision: 'apply', reason: 'ок' }, text: '{"decision":"apply","reason":"ок"}', usage: { input_tokens: 2 } };

function setup({ outcomes = [OK], token = 'sk-ant-oat01-t', geminiKey = 'g', gemini: geminiReply } = {}) {
  const runs = [];
  const fetches = [];
  const config = { version: 't', token, timezone: 'Asia/Bangkok' };
  const breaker = createBreaker({ scoreMaxUtil: 0.8 });
  const lanes = createLanes();
  const gemini = createGemini({
    key: geminiKey,
    intervalMs: 0,
    fetchImpl: async (url, opts) => {
      fetches.push({ url, opts, body: JSON.parse(opts.body) });
      const reply = geminiReply ?? { status: 200, json: { candidates: [{ content: { parts: [{ text: '{"decision":"maybe","reason":"g"}' }] } }] } };
      return { status: reply.status, text: async () => JSON.stringify(reply.json) };
    },
  });
  const run = async (req, opts) => {
    runs.push({ req, opts });
    return outcomes.length > 1 ? outcomes.shift() : outcomes[0];
  };
  return { handler: createHandler({ config, breaker, lanes, gemini, run }), runs, fetches, breaker };
}

test('parseRequest: модель из списка, задача, усилие, срок; Fable и алиасы — нет', () => {
  const r = parseRequest(body(), 1000);
  assert.equal(r.task, 'score');
  assert.equal(r.family, 'haiku');
  assert.equal(r.deadline, 171000);
  assert.equal(r.user, 'вакансия');
  assert.deepEqual(r.fallback.body, GEMINI_BODY);
  for (const model of ['claude-fable-5-1', 'haiku', 'sonnet', 'default', 'claude-haiku-4-5']) {
    assert.match(parseRequest(body({ model }), 0).error, /не из списка/, model);
  }
  assert.match(parseRequest(body({ messages: [] }), 0).error, /нет текста/);
  assert.equal(parseRequest(body({ task: 'что-то', effort: 'ultra' }), 0).task, 'text');
  assert.equal(parseRequest(body({ effort: 'ultra' }), 0).effort, 'low');
});

test('CLI ответил: форма Claude API, provider claude-cli, фактическая модель', async () => {
  const { handler, runs, fetches } = setup();
  const out = await handler.complete(body());
  assert.equal(out.status, 200);
  assert.equal(out.body.provider, 'claude-cli');
  assert.equal(out.body.model, 'claude-haiku-5-5');
  assert.equal(out.body.type, 'message');
  assert.deepEqual(JSON.parse(out.body.content[0].text), OK.json);
  assert.equal(runs[0].req.effort, 'low');
  assert.ok(runs[0].opts.timeoutMs <= 60000);
  assert.equal(fetches.length, 0);
});

test('лимит: этот вызов — Gemini тем же телом, дальше CLI не запускается до сброса', async () => {
  const until = Date.now() + 3600000;
  const { handler, runs, fetches } = setup({ outcomes: [{ kind: 'limit', until, family: 'all', message: "You've hit your session limit" }] });
  const out = await handler.complete(body());
  assert.equal(out.status, 200);
  assert.equal(out.body.provider, 'gemini');
  assert.equal(out.body.model, 'gemini-3.5-flash-lite');
  assert.equal(out.body.fallback.reason, 'limit');
  assert.equal(out.body.fallback.until, new Date(until).toISOString());
  assert.match(out.body.fallback.note, /^лимит подписки до \d\d:\d\d$/);
  assert.ok(out.body.candidates);
  assert.deepEqual(fetches[0].body, GEMINI_BODY);
  assert.match(fetches[0].url, /models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(fetches[0].opts.headers['x-goog-api-key'], 'g');
  // Второй вызов: предохранитель — claude не запускаем
  const again = await handler.complete(body());
  assert.equal(again.body.provider, 'gemini');
  assert.equal(runs.length, 1);
  assert.equal(handler.state().stats.reasons.limit, 2);
});

test('вход слетел без ключа Gemini — 401 в форме Claude API, причина и модель', async () => {
  const { handler } = setup({ outcomes: [{ kind: 'auth', message: 'OAuth access token is invalid' }], geminiKey: '' });
  const out = await handler.complete(body());
  assert.equal(out.status, 401);
  assert.equal(out.body.type, 'error');
  assert.equal(out.body.error.type, 'authentication_error');
  assert.match(out.body.error.message, /^Claude по подписке: вход не работает/);
  assert.equal(out.body.provider, 'claude-cli');
  assert.equal(out.body.reason, 'auth');
});

test('без запасного тела — ошибка, даже если ключ Gemini есть; лимит — 429 с until', async () => {
  const until = Date.now() + 600000;
  const { handler, fetches } = setup({ outcomes: [{ kind: 'limit', until, family: 'sonnet' }] });
  const out = await handler.complete(body({ model: 'claude-sonnet-5-5', task: 'text', fallback: undefined }));
  assert.equal(out.status, 429);
  assert.equal(out.body.until, new Date(until).toISOString());
  assert.match(out.body.error.message, /лимит Sonnet до/);
  assert.equal(fetches.length, 0);
});

test('Gemini тоже ошибся: его статус и тело, provider gemini', async () => {
  const { handler } = setup({
    outcomes: [{ kind: 'down', message: '529' }],
    gemini: { status: 429, json: { error: { code: 429, message: 'Quota exceeded … PerDay', status: 'RESOURCE_EXHAUSTED' } } },
  });
  const out = await handler.complete(body());
  assert.equal(out.status, 429);
  assert.equal(out.body.provider, 'gemini');
  assert.match(out.body.error.message, /PerDay/);
  assert.equal(out.body.fallback.reason, 'down');
});

test('нет токена: claude не запускается, сразу Gemini с причиной notoken', async () => {
  const { handler, runs } = setup({ token: '' });
  const out = await handler.complete(body());
  assert.equal(out.body.provider, 'gemini');
  assert.equal(out.body.fallback.reason, 'notoken');
  assert.equal(runs.length, 0);
});

test('бюджет оценок: окно занято — оценка в Gemini, письмо — в CLI', async () => {
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  const window = { five_hour: { utilization: 0.9, resetsAt }, seven_day: { utilization: 0.3, resetsAt: resetsAt + 86400 } };
  const { handler, runs } = setup({ outcomes: [{ ...OK, window }] });
  await handler.complete(body());
  const score = await handler.complete(body());
  assert.equal(score.body.provider, 'gemini');
  assert.equal(score.body.fallback.reason, 'budget');
  assert.match(score.body.fallback.note, /занято на 90%/);
  const letter = await handler.complete(body({ model: 'claude-sonnet-5-5', task: 'text' }));
  assert.equal(letter.body.provider, 'claude-cli');
  assert.equal(runs.length, 2);
});

test('срок короткий: CLI не успеет — сразу Gemini (busy), запуска нет', async () => {
  const { handler, runs } = setup();
  const out = await handler.complete(body({ deadline_ms: 45000 }));
  assert.equal(out.body.fallback.reason, 'busy');
  assert.equal(runs.length, 0);
});

test('время CLI ограничено сроком n8n с запасом на Gemini', async () => {
  const { handler, runs } = setup();
  await handler.complete(body({ model: 'claude-sonnet-5-5', task: 'text', deadline_ms: 170000 }));
  assert.ok(runs[0].opts.timeoutMs <= 135000 && runs[0].opts.timeoutMs > 130000, String(runs[0].opts.timeoutMs));
  await handler.complete(body({ model: 'claude-sonnet-5-5', task: 'text', deadline_ms: 290000 }));
  assert.ok(runs[1].opts.timeoutMs <= 255000 && runs[1].opts.timeoutMs > 250000, String(runs[1].opts.timeoutMs));
});

test('n8n закрыл соединение — отвечать некому (null), предохранитель не трогаем', async () => {
  const { handler, breaker } = setup({ outcomes: [{ kind: 'aborted' }] });
  const controller = new AbortController();
  const pending = handler.complete(body(), { signal: controller.signal });
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(breaker.blocked({ task: 'score', family: 'haiku' }), null);
});

test('симуляция: limit включает предохранитель на 10 мин, reset снимает', async () => {
  const { handler, runs } = setup();
  assert.equal(handler.simulate(['что-то']).ok, false);
  assert.deepEqual(handler.simulate(['limit']).queued, ['limit']);
  const out = await handler.complete(body());
  assert.equal(out.body.fallback.reason, 'limit');
  assert.equal((await handler.complete(body())).body.fallback.reason, 'limit');
  assert.equal(runs.length, 0);
  handler.reset();
  assert.equal((await handler.complete(body())).body.provider, 'claude-cli');
  assert.equal(runs.length, 1);
});

test('модель не из списка — 400, ничего не запускаем', async () => {
  const { handler, runs, fetches } = setup();
  const out = await handler.complete(body({ model: 'claude-fable-5-1' }));
  assert.equal(out.status, 400);
  assert.equal(out.body.error.type, 'invalid_request_error');
  assert.equal(runs.length + fetches.length, 0);
});
