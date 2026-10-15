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

// ---------- Чтение резюме (часть D, S2) ----------
// InitialState страницы /resume/<hash> → applicantResume (E0, docs/recommendations.md → «Итог E0»): поля hh — массивы
// [{ string }], опыт — experience[] { id, companyName, position, description, startDate, endDate }, пределы — _conditions.
// Список «Моих резюме» — applicantResumes[] с теми же _attributes, title, accessType.

// Пределы hh по умолчанию (E0, 15.10.2026) — если в _conditions их не нашлось
export const RESUME_LIMITS = { title: 100, about: 32768, keySkills: 30, keySkill: 100, position: 512, description: 32768 };

// Первая строка поля hh: [{ string }] → строка
const one = (v) => String((Array.isArray(v) ? v[0]?.string : v?.string ?? v) ?? '').trim();
const isoOf = (t) => (Number.isFinite(t) || /^\d{4}-/.test(String(t ?? '')) ? new Date(t).toISOString() : '');

// «Мои резюме» → [{ hash, title, access, status, updated }]; access: clients — видно работодателям, no_one — никому
export function resumeList(state) {
  const list = Array.isArray(state?.applicantResumes) ? state.applicantResumes : [];
  return list
    .map((r) => ({
      hash: String(r?._attributes?.hash ?? ''),
      title: one(r?.title),
      access: one(r?.accessType),
      status: String(r?._attributes?.status ?? ''),
      updated: isoOf(r?._attributes?.updated),
    }))
    .filter((r) => r.hash);
}

// Какое резюме читать: заданное по хешу, иначе первое видимое работодателям, иначе первое
export const pickResume = (list, hash = '') =>
  hash ? list.find((r) => r.hash === hash) ?? null : list.find((r) => r.access && r.access !== 'no_one') ?? list[0] ?? null;

// applicantResume → поля для бота или null (не резюме). Места — в порядке hh (новые сверху)
export function parseResume(r) {
  if (!r || typeof r !== 'object' || !r._attributes?.hash) return null;
  const c = r._conditions ?? {};
  const part = (field, key) => c[field]?.parts?.find((p) => p?.[key])?.[key] ?? {};
  const num = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
  return {
    hash: String(r._attributes.hash),
    title: one(r.title),
    about: one(r.skills),
    keySkills: (Array.isArray(r.keySkills) ? r.keySkills : []).map((k) => one(k)).filter(Boolean),
    places: (Array.isArray(r.experience) ? r.experience : []).map((e) => ({
      hhId: Number.isFinite(Number(e?.id)) ? Number(e.id) : null,
      company: String(e?.companyName ?? '').trim(),
      position: String(e?.position ?? '').trim(),
      description: String(e?.description ?? '').trim(),
      start: String(e?.startDate ?? ''),
      end: String(e?.endDate ?? ''),
    })),
    access: one(r.accessType),
    status: String(r._attributes.status ?? ''),
    updated: isoOf(r._attributes.updated),
    limits: {
      title: num(part('title', 'string').maxlength, RESUME_LIMITS.title),
      about: num(part('skills', 'string').maxlength, RESUME_LIMITS.about),
      keySkills: num(c.keySkills?.maxcount, RESUME_LIMITS.keySkills),
      keySkill: num(part('keySkills', 'string').maxlength, RESUME_LIMITS.keySkill),
      position: num(part('experience', 'position').maxlength, RESUME_LIMITS.position),
      description: num(part('experience', 'description').maxlength, RESUME_LIMITS.description),
      // Должность не может совпасть с должностью другого своего резюме
      titleNotIn: Array.isArray(part('title', 'string').not_in) ? part('title', 'string').not_in.map(String) : [],
    },
  };
}
