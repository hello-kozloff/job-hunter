// HTTP-слой: адреса, только application/json, размер тела, закрытие соединения. Обработчик подменён.
// Запуск: cd claude-cli && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';

async function withServer(handler, fn) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const stub = (overrides = {}) => ({
  complete: async () => ({ status: 200, body: { provider: 'claude-cli' } }),
  simulate: (outcomes) => ({ ok: Array.isArray(outcomes), queued: outcomes ?? [] }),
  reset: () => {},
  state: () => ({ version: 't' }),
  ...overrides,
});
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('ping и state; неизвестный адрес — 404', async () => {
  await withServer(stub(), async (base) => {
    assert.equal(await (await fetch(`${base}/ping`)).text(), 'ok');
    assert.deepEqual(await (await fetch(`${base}/state`)).json(), { version: 't' });
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/v1/messages`)).status, 404);
  });
});

test('POST не JSON (простой запрос из браузера) — 415, обработчик не зовём', async () => {
  let called = false;
  await withServer(stub({ complete: async () => ((called = true), { status: 200, body: {} }) }), async (base) => {
    const res = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(res.status, 415);
    assert.equal((await res.json()).error.type, 'invalid_request_error');
  });
  assert.equal(called, false);
});

test('битый JSON — 400; тело больше 2 МБ — 413', async () => {
  await withServer(stub(), async (base) => {
    const bad = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(bad.status, 400);
    const big = await fetch(`${base}/v1/messages`, json({ text: 'я'.repeat(1_200_000) })).catch((e) => ({ status: e.cause?.code ?? 'reset' }));
    assert.ok([413, 'ECONNRESET', 'UND_ERR_SOCKET', 'reset'].includes(big.status), String(big.status));
  });
});

test('ответ обработчика уходит как есть; simulate и reset', async () => {
  let resets = 0;
  await withServer(stub({ complete: async (body) => ({ status: 429, body: { got: body.model } }), reset: () => resets++ }), async (base) => {
    const res = await fetch(`${base}/v1/messages`, json({ model: 'claude-haiku-5-5' }));
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { got: 'claude-haiku-5-5' });
    assert.equal((await fetch(`${base}/simulate`, json({ outcomes: ['limit'] }))).status, 200);
    assert.equal((await fetch(`${base}/simulate`, json({}))).status, 400);
    await fetch(`${base}/reset`, json({}));
  });
  assert.equal(resets, 1);
});

test('n8n не дождался и закрыл соединение — обработчик получает отмену', async () => {
  let aborted;
  const done = new Promise((resolve) => {
    aborted = resolve;
  });
  const handler = stub({
    complete: (_body, { signal }) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          aborted(true);
          resolve(null);
        });
      }),
  });
  await withServer(handler, async (base) => {
    const controller = new AbortController();
    const req = fetch(`${base}/v1/messages`, { ...json({}), signal: controller.signal }).catch(() => null);
    setTimeout(() => controller.abort(), 50);
    await req;
    assert.equal(await Promise.race([done, new Promise((r) => setTimeout(() => r('нет отмены'), 2000))]), true);
  });
});
