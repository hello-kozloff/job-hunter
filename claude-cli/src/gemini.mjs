// Запасной Gemini: тот же запрос, что n8n послал бы при llm.provider = gemini — тело и модель строит n8n
// (Build-ноды), сервис только отправляет. Бесплатный тариф — 10–15 запросов в минуту: старты не чаще раза в
// intervalMs; не успеваем до срока n8n — сразу 503, строка оценки вернётся в очередь.
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

const unavailable = (message) => ({ status: 503, json: { error: { code: 503, status: 'UNAVAILABLE', message } } });

export function createGemini({ key, intervalMs = 6500, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  let nextStart = 0;
  return {
    available: Boolean(key),

    // fallback: { model, body }; deadline — мс эпохи, к которому n8n ещё ждёт. Итог — { status, json } как ответил Gemini
    async call({ model, body }, { deadline, signal } = {}) {
      const start = Math.max(now(), nextStart);
      const timeoutMs = Math.min(40000, (deadline ?? Infinity) - start - 2000);
      if (timeoutMs < 5000) return unavailable('запасной Gemini не успевает до таймаута n8n');
      nextStart = start + intervalMs;
      if (start > now()) await sleep(start - now(), signal);
      if (signal?.aborted) return unavailable('n8n закрыл соединение');
      try {
        const res = await fetchImpl(`${API}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = { error: { code: res.status, message: text.slice(0, 300) } };
        }
        return { status: res.status, json };
      } catch (e) {
        return unavailable(`Gemini не ответил: ${String(e.message ?? e).slice(0, 160)}`);
      }
    },
  };
}
