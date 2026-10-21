// Подборка hh «по резюме» для W1 (21.10.2026): адреса по очереди, как человек листает, → выдача каждого как есть.
// Только GET: строгий предохранитель рвёт любой не-GET к hh (как чтение резюме). Капча — блок робота (openState):
// дальше решает человек, W9 пришлёт тревогу по /health.
import { ensure, setGuard, strictGuard } from '../browser.mjs';
import { log } from '../log.mjs';
import { searchResult } from '../hh/search.mjs';
import { pause } from '../util.mjs';
import { openState } from './resume.mjs';

// → { ok: true, results: [{ url, ok: true, total, vacancies } | { url, ok: false, error }] } — по результату на адрес,
// в том же порядке. error: captcha | login | layout | resume | skipped (после капчи или потери входа остальные адреса
// не открываем)
export async function readSearch({ urls }) {
  const page = await ensure();
  setGuard(true);
  const relax = await strictGuard();
  const results = [];
  try {
    let stop = '';
    for (const [i, url] of urls.entries()) {
      if (stop) {
        results.push({ url, ok: false, error: 'skipped' });
        continue;
      }
      if (i) await pause(3000, 6000);
      const open = await openState(page, url, 'captcha-search');
      const found = open.error ? open : searchResult(open.state);
      if (found.error) {
        results.push({ url, ok: false, error: found.error });
        if (found.error === 'captcha' || found.error === 'login') stop = found.error;
        continue;
      }
      results.push({ url, ok: true, total: found.total, vacancies: found.vacancies });
    }
  } finally {
    await relax();
  }
  log('search.read', {
    pages: results.length,
    found: results.reduce((n, r) => n + (r.vacancies?.length ?? 0), 0),
    errors: results.filter((r) => !r.ok).map((r) => r.error),
  });
  return { ok: true, results };
}
