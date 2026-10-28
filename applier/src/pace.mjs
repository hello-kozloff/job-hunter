// Темп живых откликов (автоотклик, 20.10.2026, docs/stages/stage-6.md → 6.1c): пауза между попытками и лимит часа.
// Чистые функции без побочных эффектов — состояние { lastAttemptAt, nextAt, hour[] } хранит store.mjs в /data/state.json.
// n8n (W9) присылает темп из настроек бота в POST /apply ({ min, max } — пауза в секундах, hour — откликов в час),
// робот держит его сам: он один и однопоточный, а запусков W9 бывает два сразу. Потолки из .env (APPLIER_MIN_GAP,
// APPLIER_HOURLY_CAP) — нижняя граница паузы и верхняя граница часа, даже если n8n пришлёт другое.

// Напоминания (6.3): пауза общая с откликами (страницы смотрит один человек), свой счёт часа — remind[]
export const HOUR_MS = 3600 * 1000;
export const EMPTY_PACE = { lastAttemptAt: null, nextAt: null, hour: [], remind: [] };

// Темп запроса в пределах потолков. Без pace в теле — самый частый, что разрешают потолки
export function paceLimits(pace, { minGap, hourlyCap }) {
  const min = Math.max(minGap, Number(pace?.min) || 0);
  const max = Math.max(min, Number(pace?.max) || 0);
  const hour = Math.min(hourlyCap, Number(pace?.hour) || hourlyCap);
  return { min, max, hour: Math.max(1, hour) };
}

// Живые отклики (или напоминания) за последний час (время ISO)
const recentOf = (list, now) => (list ?? []).filter((at) => now - Date.parse(at) < HOUR_MS);
const recent = (state, now) => recentOf(state?.hour, now);

// Можно ли откликаться сейчас: null — можно; { reason: gap | hour, retryAt } — нет
export function paceCheck(state, limits, now = Date.now()) {
  const next = Date.parse(state?.nextAt ?? '');
  if (next > now) return { reason: 'gap', retryAt: new Date(next).toISOString() };
  const hour = recent(state, now);
  if (hour.length >= limits.hour) {
    const oldest = Math.min(...hour.map((at) => Date.parse(at)));
    return { reason: 'hour', retryAt: new Date(oldest + HOUR_MS).toISOString() };
  }
  return null;
}

// Можно ли напоминать сейчас по счёту часа (пауза — paceCheck): null — можно; { reason: remind_hour, retryAt } — нет
export function remindHourCheck(state, cap, now = Date.now()) {
  const hour = recentOf(state?.remind, now);
  if (hour.length < cap) return null;
  return { reason: 'remind_hour', retryAt: new Date(Math.min(...hour.map((at) => Date.parse(at))) + HOUR_MS).toISOString() };
}

// Состояние после живой попытки: пауза до следующей — случайная в [min, max] секунд; отклик ушёл → +1 в час
// откликов, напоминание ушло → +1 в час напоминаний
export function paceAfter(state, { applied, reminded = false, limits, now = Date.now(), random = Math.random }) {
  const gap = (limits.min + random() * (limits.max - limits.min)) * 1000;
  const at = new Date(now).toISOString();
  return {
    lastAttemptAt: at,
    nextAt: new Date(now + Math.round(gap)).toISOString(),
    hour: [...recent(state, now), ...(applied ? [at] : [])],
    remind: [...recentOf(state?.remind, now), ...(reminded ? [at] : [])],
  };
}

// Для /health и ответов /apply, /remind
export const paceView = (state, now = Date.now()) => ({
  lastAttemptAt: state?.lastAttemptAt ?? null,
  nextAt: state?.nextAt ?? null,
  hour: recent(state, now).length,
  remindHour: recentOf(state?.remind, now).length,
});
