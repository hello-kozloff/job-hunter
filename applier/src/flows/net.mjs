// Сетевой журнал живого отклика: ответы hh на действия (отклик, письмо, чат) — главный сигнал исхода, экран — запасной
// (план этапа 6, 4.1 п. 5). Слушаем весь контекст браузера: чат hh — в iframe, сайт работодателя — в новой вкладке.
import { ACTION_URL } from '../hh/selectors.mjs';
import { sleep } from '../util.mjs';

const kindOf = (url) => Object.keys(ACTION_URL).find((k) => ACTION_URL[k].test(url)) ?? null;

export function watchActions(context) {
  const events = [];
  const pages = [];
  const onResponse = async (response) => {
    const req = response.request();
    const kind = req.method() === 'GET' ? null : kindOf(response.url());
    if (!kind) return;
    let body = null;
    try {
      body = JSON.parse(await response.text());
    } catch {
      // не JSON или тело недоступно — исход решит код ответа
    }
    events.push({ kind, status: response.status(), body, post: req.postData() ?? '', at: Date.now() });
  };
  // Запрос оборвался (сеть, предохранитель) — тоже исход: «нет ответа»
  const onFailed = (req) => {
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
