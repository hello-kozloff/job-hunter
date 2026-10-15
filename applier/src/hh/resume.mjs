// Резюме соискателя на hh (часть D «Экспорт на hh», docs/recommendations.md) — чистые функции без Playwright
// (тесты: applier/test/resume.test.mjs). E0 (15.10.2026): адреса страниц резюме и ссылки на правку — для разведки,
// что писать в запись. Как hh сохраняет поля, покажет запись правок владельца.
import { HH, HH_PAGE } from './selectors.mjs';
import { decodeEntities } from './state.mjs';

export const RESUMES_URL = `${HH}/applicant/resumes`;
export const resumeUrl = (hash) => `${HH}/resume/${hash}`;
// Хеш резюме в адресах hh — 38 шестнадцатеричных знаков (/resume/<hash>, ?resume=<hash>); берём с запасом
const HASH = '[0-9a-f]{32,64}';

// Хеши резюме из ссылок страницы «Мои резюме» — по порядку, без повторов
export function resumeHashes(html) {
  const out = [];
  for (const m of String(html ?? '').matchAll(new RegExp(`/resume/(${HASH})(?![0-9a-f])`, 'g'))) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// Ссылка на правку: в пути есть edit. Ссылки-действия (удалить, поднять в поиске, скрыть, копия, скачать…) разведка
// не открывает никогда: у hh они могут быть простыми GET
const EDIT = /edit/i;
const ACTION = /delete|remove|touch|raise|update_?date|publish|hide|visib|access|duplicate|clone|copy|download|print|pdf|rtf|docx?|txt|send|share|archive|logout|negotiation|vacancy_response/i;

// Ссылки на страницы правки резюме hash (абсолютные, без повторов): только hh, только с хешем в адресе
export function editLinks(html, hash) {
  const out = [];
  for (const m of String(html ?? '').matchAll(/href="([^"]+)"/g)) {
    const href = decodeEntities(m[1]);
    if (!href.includes(hash)) continue;
    let url;
    try {
      url = new URL(href, HH);
    } catch {
      continue;
    }
    if (!HH_PAGE.test(url.href) || !EDIT.test(url.pathname + url.search) || ACTION.test(url.pathname + url.search)) continue;
    url.hash = '';
    if (!out.includes(url.href)) out.push(url.href);
  }
  return out;
}

// Пределы полей из InitialState: числа под ключами maxLength, minLength, maxCount… → путь → значение (до max штук).
// Ищем по всему состоянию: где hh держит пределы полей резюме, пока неизвестно
const LIMIT = /^[Mm](?:ax|in)(?:[A-Z_]|(?:length|count|size|items)$)/;
export function limitsOf(state, max = 200) {
  const out = {};
  const walk = (v, path, depth) => {
    if (Object.keys(out).length >= max || depth > 14 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.slice(0, 3).forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (Object.keys(out).length >= max) return;
      const p = path ? `${path}.${k}` : k;
      if (LIMIT.test(k) && typeof x === 'number') out[p] = x;
      else walk(x, p, depth + 1);
    }
  };
  walk(state, '', 0);
  return out;
}

// Что пишет запись (flows/record.mjs): ответы hh по отклику, чатам и «Откликам» — как раньше; для резюме — любой
// не-GET к hh (сохранение полей, копия, видимость, удаление: адреса ещё неизвестны) и GET с resume в адресе
const RECORD_XHR = /vacancy_response|negotiations|chatik|\/applicant\//;
export const recordWanted = (method, url) =>
  RECORD_XHR.test(url) || (HH_PAGE.test(url) && (method !== 'GET' || /resume/i.test(url)));
