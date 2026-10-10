// Один браузер — одно действие за раз. Замок с очередью FIFO:
//   wait = 0  — занято → сразу Busy (n8n W9 вернёт вакансию в очередь и попробует через минуту);
//   wait > 0  — подождать своей очереди (проверка входящих в 6.2 протискивается между откликами).
export class Busy extends Error {
  constructor(by) {
    super(`робот занят: ${by}`);
    this.by = by;
  }
}

let current = null; // { name, since }
const waiters = [];

function acquire(name, wait) {
  if (!current && !waiters.length) {
    current = { name, since: new Date().toISOString() };
    return Promise.resolve();
  }
  if (wait <= 0) return Promise.reject(new Busy(current?.name ?? waiters[0]?.name));
  return new Promise((resolve, reject) => {
    const waiter = { name, resolve };
    waiter.timer = setTimeout(() => {
      waiters.splice(waiters.indexOf(waiter), 1);
      reject(new Busy(current?.name ?? 'очередь'));
    }, wait);
    waiters.push(waiter);
  });
}

function release() {
  const next = waiters.shift();
  if (!next) {
    current = null;
    return;
  }
  clearTimeout(next.timer);
  current = { name: next.name, since: new Date().toISOString() };
  next.resolve();
}

export const lock = {
  get current() {
    return current;
  },
  // Выполнить fn под замком
  async run(name, fn, { wait = 0 } = {}) {
    await acquire(name, wait);
    try {
      return await fn();
    } finally {
      release();
    }
  },
  // Взять замок надолго (запись действий пользователя, фоновая разведка); вернуть — вызвать результат
  async hold(name, { wait = 0 } = {}) {
    await acquire(name, wait);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  },
  // Дождаться, пока замок освободится (мягкая остановка контейнера)
  async idle(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (current && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
    return !current;
  },
};
