// Сетевой журнал живого отклика: ответы hh на действия (отклик, письмо, чат) — главный сигнал исхода, экран — запасной
// (план этапа 6, 4.1 п. 5). Слушаем весь контекст браузера: чат hh — в iframe, сайт работодателя — в новой вкладке.
import { ACTION_URL } from '../hh/selectors.mjs';
import { sleep } from '../util.mjs';

const kindOf = (url) => Object.keys(ACTION_URL).find((k) => ACTION_URL[k].test(url)) ?? null;

// bodyMs — сколько ждать тело ответа: страница может уйти сразу после ответа (форма резюме → страница резюме, 15.10.2026),
// и тело тогда не дочитать никогда. 0 — без предела, как у отклика
export function watchActions(context, { bodyMs = 0 } = {}) {
  const events = [];
  const pages = [];
  // Ответ уже пришёл — обрыв после него (страница ушла, не дочитав тело) — не «нет ответа»
  const answered = new WeakSet();
  const onResponse = async (response) => {
    const req = response.request();
    const kind = req.method() === 'GET' ? null : kindOf(response.url());
    if (!kind) return;
    answered.add(req);
    let body = null;
    try {
      const text = bodyMs ? await Promise.race([response.text(), sleep(bodyMs).then(() => null)]) : await response.text();
      body = text === null ? null : JSON.parse(text);
    } catch {
      // не JSON или тело недоступно — исход решит код ответа
    }
    events.push({ kind, status: response.status(), body, post: req.postData() ?? '', at: Date.now() });
  };
  // Запрос оборвался (сеть, предохранитель) — тоже исход: «нет ответа»
  const onFailed = (req) => {
    if (answered.has(req)) return;
    const kind = req.method() === 'GET' ? null : kindOf(req.url());
    if (kind) events.push({ kind, status: 0, body: null, post: '', failure: req.failure()?.errorText ?? '', at: Date.now() });
  };
  const onPage = (p) => pages.push(p);
  context.on('response', onResponse);
  context.on('requestfailed', onFailed);
  context.on('page', onPage);

  const take = (kind) => {
    const i = events.findIndex((e) => e.kind === kind);
    return i < 0 ? null : events.splice(i, 1)[0];
  };
  return {
    pages,
    take,
    // Дождаться ответа на действие kind (≤ ms) или null
    async wait(kind, ms) {
      const end = Date.now() + ms;
      for (;;) {
        const e = take(kind);
        if (e || Date.now() >= end) return e;
        await sleep(250);
      }
    },
    stop() {
      context.off('response', onResponse);
      context.off('requestfailed', onFailed);
      context.off('page', onPage);
    },
  };
}
