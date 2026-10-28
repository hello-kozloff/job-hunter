// Тесты темпа живых откликов (автоотклик, 6.1c): пауза между попытками, лимит часа, потолки .env.
// Запуск: cd applier && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_PACE, HOUR_MS, paceAfter, paceCheck, paceLimits, paceView, remindHourCheck } from '../src/pace.mjs';

const CAPS = { minGap: 15, hourlyCap: 40 };
const T0 = Date.parse('2026-10-20T05:00:00Z');

test('paceLimits: темп из бота в пределах потолков .env', () => {
  assert.deepEqual(paceLimits({ min: 20, max: 60, hour: 30 }, CAPS), { min: 20, max: 60, hour: 30 });
  // Пауза короче нижней границы и час выше потолка — по потолкам
  assert.deepEqual(paceLimits({ min: 5, max: 10, hour: 100 }, CAPS), { min: 15, max: 15, hour: 40 });
  // Без темпа (старый n8n, CLI) — самый частый, что разрешают потолки
  assert.deepEqual(paceLimits(undefined, CAPS), { min: 15, max: 15, hour: 40 });
  // max меньше min — пауза ровно min
  assert.deepEqual(paceLimits({ min: 60, max: 20, hour: 0 }, CAPS), { min: 60, max: 60, hour: 40 });
});

test('paceCheck: первая попытка можно, во время паузы — gap до nextAt', () => {
  const limits = paceLimits({ min: 20, max: 60, hour: 30 }, CAPS);
  assert.equal(paceCheck(EMPTY_PACE, limits, T0), null);
  const after = paceAfter(EMPTY_PACE, { applied: true, limits, now: T0, random: () => 0.5 });
  assert.equal(after.nextAt, new Date(T0 + 40000).toISOString());
  assert.deepEqual(paceCheck(after, limits, T0 + 39000), { reason: 'gap', retryAt: after.nextAt });
  assert.equal(paceCheck(after, limits, T0 + 40000), null);
});

test('paceAfter: пауза случайная в [min, max], в час считаются только ушедшие отклики', () => {
  const limits = { min: 20, max: 60, hour: 30 };
  const lo = paceAfter(EMPTY_PACE, { applied: false, limits, now: T0, random: () => 0 });
  const hi = paceAfter(EMPTY_PACE, { applied: false, limits, now: T0, random: () => 0.999999 });
  assert.equal(Date.parse(lo.nextAt) - T0, 20000);
  assert.ok(Date.parse(hi.nextAt) - T0 <= 60000 && Date.parse(hi.nextAt) - T0 > 59000);
  assert.deepEqual(lo.hour, []);
  assert.equal(lo.lastAttemptAt, new Date(T0).toISOString());
});

test('paceCheck: лимит часа — hour до часа после самого старого отклика; старые забываются', () => {
  const limits = { min: 15, max: 15, hour: 3 };
  let state = EMPTY_PACE;
  for (const min of [0, 10, 20]) state = paceAfter(state, { applied: true, limits, now: T0 + min * 60000, random: () => 0 });
  assert.equal(paceView(state, T0 + 21 * 60000).hour, 3);
  assert.deepEqual(paceCheck(state, limits, T0 + 21 * 60000), { reason: 'hour', retryAt: new Date(T0 + HOUR_MS).toISOString() });
  // Через час первый отклик выпал из окна
  assert.equal(paceCheck(state, limits, T0 + HOUR_MS), null);
  assert.equal(paceView(state, T0 + HOUR_MS).hour, 2);
  // Новая попытка чистит окно: в состоянии только последний час
  const next = paceAfter(state, { applied: true, limits, now: T0 + HOUR_MS + 1000, random: () => 0 });
  assert.equal(next.hour.length, 3);
});

test('paceCheck: битое состояние не ломает отклик', () => {
  const limits = { min: 15, max: 15, hour: 3 };
  assert.equal(paceCheck({ nextAt: 'мусор', hour: null }, limits, T0), null);
  assert.equal(paceCheck(undefined, limits, T0), null);
  assert.deepEqual(paceView(undefined, T0), { lastAttemptAt: null, nextAt: null, hour: 0, remindHour: 0 });
});

// Закрытый режим вакансии (20.10.2026): 403 + страница hh ForbiddenPage — закрыта, другой 403 — нет
test('isForbiddenVacancy: 403 со страницей «Вам недоступна эта вакансия» — закрыта', async () => {
  const { isForbiddenVacancy } = await import('../src/hh/state.mjs');
  const page = '<script>window.globalVars = {"lang": "RU", "luxPageName": "ForbiddenPage", "pageName": "vacancy"}</script>';
  assert.equal(isForbiddenVacancy(403, page), true);
  assert.equal(isForbiddenVacancy(200, page), false);
  assert.equal(isForbiddenVacancy(403, '<html>Access denied</html>'), false);
  assert.equal(isForbiddenVacancy(403, ''), false);
});

test('напоминания (6.3): пауза общая с откликами, свой лимит часа; лимит часа откликов не тратят', () => {
  const limits = paceLimits({ min: 20, max: 60, hour: 30 }, CAPS);
  let s = EMPTY_PACE;
  for (let i = 0; i < 3; i++) s = paceAfter(s, { applied: false, reminded: true, limits, now: T0 + i * 60000, random: () => 0 });
  const now = T0 + 3 * 60000;
  assert.deepEqual([paceView(s, now).hour, paceView(s, now).remindHour], [0, 3]);
  assert.equal(remindHourCheck(s, 4, now), null);
  assert.deepEqual(remindHourCheck(s, 3, now), { reason: 'remind_hour', retryAt: new Date(T0 + HOUR_MS).toISOString() });
  // Через час счёт напоминаний обнуляется; сухая попытка (reminded: false) ставит паузу, но не считается
  const later = paceAfter(s, { applied: false, reminded: false, limits, now: T0 + HOUR_MS + 180000, random: () => 0 });
  assert.equal(paceView(later, T0 + HOUR_MS + 180000).remindHour, 0);
  assert.deepEqual(paceCheck(later, limits, T0 + HOUR_MS + 190000)?.reason, 'gap');
  // Старое состояние без remind[] (до 6.3) — пусто
  assert.equal(remindHourCheck({ hour: [] }, 1, now), null);
});
