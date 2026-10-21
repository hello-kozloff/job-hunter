// Разбор stream-json claude -p: настоящие ответы разведки 19.10.2026 (ok-*, auth) и синтетические (*-synthetic —
// лимит на подписке нарочно не вызвать). Запуск: cd claude-cli && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feed, newRun, outcome, parseReset } from '../src/stream.mjs';

const replay = (name) => {
  const run = newRun();
  const signals = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => feed(run, line));
  return { run, signals };
};
// 19.10.2026 10:00 по Бангкоку
const NOW = Date.parse('2026-10-19T03:00:00Z');
const TZ = 'Asia/Bangkok';

test('оценка Haiku: ответ по схеме, модель и токены', () => {
  const { run, signals } = replay('ok-score.jsonl');
  assert.equal(signals.at(-1), 'done');
  const out = outcome(run, { now: NOW, tz: TZ });
  assert.equal(out.kind, 'ok');
  assert.equal(out.model, 'claude-haiku-5-5');
  assert.equal(out.json.decision, 'apply');
  assert.deepEqual(JSON.parse(out.text), out.json);
  assert.equal(out.usage.cache_creation_input_tokens, 3330);
  assert.equal(out.window.five_hour.utilization, 0.53);
});

test('письмо Sonnet: события мышления не мешают, план и абзацы в ответе', () => {
  const { run } = replay('ok-letter.jsonl');
  const out = outcome(run, { now: NOW, tz: TZ });
  assert.equal(out.kind, 'ok');
  assert.equal(out.model, 'claude-sonnet-5-5');
  assert.ok(out.json.needs.length >= 2);
  assert.match(out.json.first, /Альфа Софт/);
  assert.ok(out.usage.thinking_tokens > 0);
});

test('неверный токен: api_retry authentication_failed — сразу на выход, итог auth', () => {
  const { run, signals } = replay('auth.jsonl');
  assert.equal(signals[1], 'fatal');
  const out = outcome(run, { now: NOW, tz: TZ });
  assert.equal(out.kind, 'auth');
  assert.match(out.message, /OAuth access token is invalid/);
});

test('лимит подписки: время сброса из rate_limit_event, для всех моделей', () => {
  const { run } = replay('limit-synthetic.jsonl');
  const out = outcome(run, { now: NOW, tz: TZ });
  assert.equal(out.kind, 'limit');
  assert.equal(out.until, 1792408200 * 1000);
  assert.equal(out.family, 'all');
  assert.equal(out.window.five_hour.utilization, 1);
});

test('лимит Sonnet: одна линейка, сброс в понедельник 00:00 по поясу', () => {
  const { run } = replay('sonnet-limit-synthetic.jsonl');
  const out = outcome(run, { now: NOW, tz: TZ });
  assert.equal(out.kind, 'limit');
  assert.equal(out.family, 'sonnet');
  // 19.10.2026 — понедельник, 10:00 → следующий понедельник 00:00 по Бангкоку
  assert.equal(new Date(out.until).toISOString(), '2026-10-25T17:00:00.000Z');
});

test('ответ не по схеме после повторов — bad', () => {
  const { run } = replay('bad-schema-synthetic.jsonl');
  const out = outcome(run, { now: NOW, tz: TZ });
  assert.equal(out.kind, 'bad');
  assert.equal(out.model, 'claude-haiku-5-5');
});

test('успех без structured_output при схеме — bad, без схемы — текст', () => {
  const run = newRun();
  feed(run, JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'просто текст', modelUsage: {} }));
  assert.equal(outcome(run).kind, 'bad');
  const plain = outcome(run, { schema: false });
  assert.equal(plain.kind, 'ok');
  assert.equal(plain.text, 'просто текст');
});

test('таймаут и отмена — свои исходы, итог не важен', () => {
  const { run } = replay('ok-score.jsonl');
  assert.equal(outcome(run, { killed: 'timeout' }).kind, 'timeout');
  assert.equal(outcome(run, { killed: 'aborted' }).kind, 'aborted');
});

test('разовый 429 без признаков подписки — пауза 5 мин; перегрузка — down', () => {
  const limited = newRun();
  feed(limited, JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'rate_limit', error_status: 429 }));
  const out = outcome(limited, { now: NOW });
  assert.equal(out.kind, 'limit');
  assert.equal(out.until, NOW + 5 * 60000);
  const busy = newRun();
  feed(busy, JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'overloaded', error_status: 529 }));
  feed(busy, JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 529, result: 'API Error: 529 Overloaded' }));
  assert.equal(outcome(busy, { now: NOW }).kind, 'down');
});

test('имя модели в stderr не делает лимит «лимитом линейки»', () => {
  const run = newRun();
  feed(run, JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: "You've hit your session limit · resets 6:10pm" }));
  const out = outcome(run, { now: NOW, tz: TZ, stderr: '[claude-code:unrecognized_model] {"model":"claude-haiku-5-5"}' });
  assert.equal(out.family, 'all');
  assert.equal(new Date(out.until).toISOString(), '2026-10-19T11:10:00.000Z');
});

test('parseReset: формы времени сброса', () => {
  assert.equal(parseReset('Claude AI usage limit reached|1792408200', NOW, TZ), 1792408200 * 1000);
  // 15:00 по Бангкоку сегодня (сейчас 10:00)
  assert.equal(new Date(parseReset('resets at 15:00', NOW, TZ)).toISOString(), '2026-10-19T08:00:00.000Z');
  assert.equal(new Date(parseReset('resets 3pm', NOW, TZ)).toISOString(), '2026-10-19T08:00:00.000Z');
  // 9:30am уже прошло — завтра
  assert.equal(new Date(parseReset('resets 9:30am', NOW, TZ)).toISOString(), '2026-10-20T02:30:00.000Z');
  assert.equal(new Date(parseReset('resets 12am', NOW, TZ)).toISOString(), '2026-10-19T17:00:00.000Z');
  assert.equal(parseReset('нет времени', NOW, TZ), null);
  assert.equal(parseReset('resets 25:00', NOW, TZ), null);
});
