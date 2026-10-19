// Предохранитель и дорожки. Запуск: cd claude-cli && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBreaker } from '../src/limits.mjs';
import { createLanes } from '../src/lanes.mjs';

const clock = (start) => {
  let t = start;
  return { now: () => t, add: (ms) => (t += ms) };
};

test('лимит всей подписки — до сброса для любых моделей', () => {
  const c = clock(1000);
  const b = createBreaker({ now: c.now });
  b.record({ kind: 'limit', until: 61000, family: 'all' });
  assert.deepEqual(b.blocked({ task: 'text', family: 'sonnet' }), { reason: 'limit', until: 61000, family: 'all' });
  assert.equal(b.blocked({ task: 'score', family: 'haiku' }).reason, 'limit');
  c.add(60000);
  assert.equal(b.blocked({ task: 'score', family: 'haiku' }), null);
});

test('лимит Sonnet не останавливает оценку на Haiku', () => {
  const c = clock(0);
  const b = createBreaker({ now: c.now });
  b.record({ kind: 'limit', until: 3600000, family: 'sonnet' });
  assert.equal(b.blocked({ task: 'text', family: 'sonnet' }).family, 'sonnet');
  assert.equal(b.blocked({ task: 'score', family: 'haiku' }), null);
});

test('вход слетел — 30 минут без CLI, reset снимает', () => {
  const c = clock(0);
  const b = createBreaker({ now: c.now });
  b.record({ kind: 'auth' });
  assert.equal(b.blocked({ task: 'text', family: 'sonnet' }).reason, 'auth');
  c.add(29 * 60000);
  assert.equal(b.blocked({ task: 'text', family: 'sonnet' }).reason, 'auth');
  b.reset();
  assert.equal(b.blocked({ task: 'text', family: 'sonnet' }), null);
});

test('бюджет оценок: окно занято на 80% — оценка в Gemini, письма — в Claude', () => {
  const c = clock(1_000_000);
  const b = createBreaker({ now: c.now, scoreMaxUtil: 0.8 });
  const resetsAt = (1_000_000 + 3600000) / 1000;
  b.record({ kind: 'ok', window: { five_hour: { utilization: 0.85, resetsAt }, seven_day: { utilization: 0.4, resetsAt: resetsAt * 2 } } });
  const why = b.blocked({ task: 'score', family: 'haiku' });
  assert.equal(why.reason, 'budget');
  assert.equal(why.utilization, 0.85);
  assert.equal(why.until, resetsAt * 1000);
  assert.equal(b.blocked({ task: 'text', family: 'sonnet' }), null);
  // Окно сбросилось — бюджет снова есть
  c.add(3600000);
  assert.equal(b.blocked({ task: 'score', family: 'haiku' }), null);
});

test('недельное окно тоже считается; без данных о загрузке — бюджета нет', () => {
  const b = createBreaker({ now: () => 0, scoreMaxUtil: 0.8 });
  assert.equal(b.blocked({ task: 'score', family: 'haiku' }), null);
  b.record({ kind: 'ok', window: { five_hour: { utilization: 0.1, resetsAt: 100 }, seven_day: { utilization: 0.9, resetsAt: 200 } } });
  assert.equal(b.blocked({ task: 'score', family: 'haiku' }).window, 'seven_day');
});

test('дорожка: по одному, очередь по порядку', async () => {
  const lanes = createLanes({ score: 1, text: 2 });
  const order = [];
  const first = await lanes.acquire('score');
  const second = lanes.acquire('score').then((release) => {
    order.push('second');
    return release;
  });
  assert.deepEqual(lanes.state().score, { running: 1, waiting: 1 });
  order.push('first done');
  first();
  (await second)();
  assert.deepEqual(order, ['first done', 'second']);
  assert.equal(lanes.running(), 0);
});

test('дорожка текстов — два сразу, оценка им не мешает', async () => {
  const lanes = createLanes({ score: 1, text: 2 });
  const score = await lanes.acquire('score');
  const a = await lanes.acquire('text');
  const b = await lanes.acquire('text');
  assert.equal(lanes.running(), 3);
  [score, a, b].forEach((release) => release());
  assert.equal(lanes.running(), 0);
});

test('не дождались места к сроку — null; отмена — null; освобождение повторно — без эффекта', async () => {
  const lanes = createLanes({ score: 1 });
  const held = await lanes.acquire('score');
  assert.equal(await lanes.acquire('score', { waitUntil: Date.now() + 20 }), null);
  const controller = new AbortController();
  const pending = lanes.acquire('score', { signal: controller.signal });
  controller.abort();
  assert.equal(await pending, null);
  held();
  held();
  assert.equal(lanes.running(), 0);
  assert.deepEqual(lanes.state().score, { running: 0, waiting: 0 });
  // Место снова свободно
  const again = await lanes.acquire('score', { waitUntil: Date.now() + 20 });
  assert.equal(typeof again, 'function');
  again();
});
