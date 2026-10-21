// Дорожки: оценка (W2) — по одному запуску, тексты (W5, W11, W13) — до двух параллельно, чтобы пачка оценок не
// задерживала письмо. n8n шлёт запросы пачки, не дожидаясь ответов (batchInterval разносит только старты), поэтому
// очередь живёт здесь. Не дождались места к сроку или n8n закрыл соединение — acquire отдаёт null.
export function createLanes(limits = { score: 1, text: 2 }) {
  const lanes = Object.fromEntries(Object.entries(limits).map(([name, max]) => [name, { max, running: 0, queue: [] }]));

  const release = (lane) => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      lane.running -= 1;
      pump(lane);
    };
  };

  function pump(lane) {
    while (lane.running < lane.max && lane.queue.length) lane.queue.shift().grant();
  }

  return {
    // Место на дорожке: функция «освободить» или null (срок waitUntil прошёл, отмена)
    acquire(name, { waitUntil = Infinity, signal } = {}) {
      const lane = lanes[name];
      if (!lane) throw new Error(`нет дорожки ${name}`);
      return new Promise((resolve) => {
        let finished = false;
        let timer = null;
        const finish = (value) => {
          if (finished) return false;
          finished = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
          return true;
        };
        const onAbort = () => finish(null);
        const waiter = {
          grant() {
            if (finished) return;
            lane.running += 1;
            finish(release(lane));
          },
          waiting: () => !finished,
        };
        if (signal?.aborted) return finish(null);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (Number.isFinite(waitUntil)) timer = setTimeout(() => finish(null), Math.max(0, waitUntil - Date.now()));
        lane.queue.push(waiter);
        pump(lane);
      });
    },

    state() {
      return Object.fromEntries(
        Object.entries(lanes).map(([name, l]) => [name, { running: l.running, waiting: l.queue.filter((w) => w.waiting()).length }]),
      );
    },

    // Сколько запусков идёт сейчас (мягкая остановка ждёт ноль)
    running() {
      return Object.values(lanes).reduce((n, l) => n + l.running, 0);
    },
  };
}
