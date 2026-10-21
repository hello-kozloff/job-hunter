// Предохранитель: когда не запускать claude, а сразу отдать вызов запасному Gemini.
//   лимит подписки — до времени сброса, для всех моделей или одной линейки (лимит Sonnet не трогает оценку на Haiku);
//   вход слетел (токен истёк, отозван) — 30 мин: новый токен приходит деплоем, он перезапускает сервис;
//   бюджет оценок — W2 не берёт подписку, если окно 5 ч или неделя занято на scoreMaxUtil и больше (загрузку CLI
//   присылает в rate_limit_event после каждого вызова): твоя работа в Claude Code важнее сбора.
// Состояние — в памяти: перезапуск сервиса его сбрасывает.
const AUTH_PAUSE_MS = 30 * 60 * 1000;
const WINDOWS = ['five_hour', 'seven_day'];

export function createBreaker({ now = () => Date.now(), scoreMaxUtil = 0.8 } = {}) {
  let until = {};
  let authUntil = 0;
  let window = null;
  let windowAt = null;

  return {
    // Почему вызов не пойдёт в CLI: { reason, until } или null
    blocked({ task, family }) {
      const t = now();
      if (t < authUntil) return { reason: 'auth', until: authUntil };
      const limit = Math.max(until.all ?? 0, until[family] ?? 0);
      if (t < limit) return { reason: 'limit', until: limit, family: (until[family] ?? 0) > (until.all ?? 0) ? family : 'all' };
      if (task === 'score' && window) {
        for (const name of WINDOWS) {
          const w = window[name];
          const resetsAt = Number(w?.resetsAt) * 1000;
          if (w && w.utilization >= scoreMaxUtil && t < resetsAt) {
            return { reason: 'budget', until: resetsAt, utilization: w.utilization, window: name };
          }
        }
      }
      return null;
    },

    // Итог запуска CLI → предохранитель и загрузка окон
    record(out) {
      if (out.window) {
        window = out.window;
        windowAt = now();
      }
      if (out.kind === 'limit') {
        const key = out.family && out.family !== 'all' ? out.family : 'all';
        until[key] = Math.max(until[key] ?? 0, out.until);
      }
      if (out.kind === 'auth') authUntil = now() + AUTH_PAUSE_MS;
    },

    reset() {
      until = {};
      authUntil = 0;
    },

    state() {
      const t = now();
      const iso = (ms) => (ms > t ? new Date(ms).toISOString() : null);
      return {
        limitUntil: Object.fromEntries(Object.entries(until).map(([k, v]) => [k, iso(v)]).filter(([, v]) => v)),
        authUntil: iso(authUntil),
        window,
        windowAt: windowAt && new Date(windowAt).toISOString(),
        scoreMaxUtil,
      };
    },
  };
}
