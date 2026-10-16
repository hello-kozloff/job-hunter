// Резюме соискателя на hh (часть D «Экспорт на hh», docs/recommendations.md) — чистые функции без Playwright
// (тесты: applier/test/resume.test.mjs). E0 (15.10.2026): адреса страниц резюме и ссылки на правку — для разведки,
// что писать в запись. Как hh сохраняет поля, покажет запись правок владельца.
import { HH, HH_PAGE } from './selectors.mjs';
import { decodeEntities } from './state.mjs';
import { errorCode } from './xhr.mjs';

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

// Значения поля hh [{ string }, …] → строки
const strings = (v) => (Array.isArray(v) ? v : []).map((x) => String(x?.string ?? '').trim()).filter(Boolean);

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
    // Что человек выбрал на hh сам (импорт резюме в бота, docs/resumes.md): профессиональные роли (id как в поиске hh),
    // формат работы, желаемая зарплата, общий стаж в месяцах. Имя, пол и контакты не отдаём: они уже в профиле бота
    roles: (Array.isArray(r.professionalRole) ? r.professionalRole : [])
      .map((x) => ({ id: String(x?.id ?? x?.string ?? ''), text: String(x?.text ?? '').trim() }))
      .filter((x) => /^\d{1,4}$/.test(x.id)),
    formats: strings(r.workFormats),
    salary: Number(r.salary?.[0]?.amount) > 0 ? { amount: Math.round(Number(r.salary[0].amount)), currency: String(r.salary[0].currency ?? '') } : null,
    months: Math.max(0, Math.round(Number(one(r.totalExperience)) || 0)),
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

// ---------- Запись резюме (часть D, E2/E3) ----------
// Поля пишутся через формы hh, как человек (в теле сохранения — отпечатки браузера, E0). Здесь — адреса форм, проверка
// изменений и разбор ответа hh; сам сценарий — src/flows/resume.mjs → writeResume.

// Форма раздела: должность, навыки, «О себе» — у резюме; место работы — в профиле (общее для всех резюме)
export const cvFormUrl = (kind, hash, hhId) =>
  kind === 'place'
    ? `${HH}/profile/edit/experience/${hhId}?resumeFrom=${hash}`
    : `${HH}/resume/edit/${hash}/${{ title: 'position', skills: 'keySkills', about: 'about' }[kind]}`;

// Изменения для записи: [{ kind: title, value } | { kind: about, value } | { kind: skills, skills } |
// { kind: place, hhId, position?, description? }] — в пределах hh (E0). → { changes } или { error }
export function cleanChanges(list, limits = RESUME_LIMITS) {
  if (!Array.isArray(list) || !list.length || list.length > 40) return { error: 'нужно от 1 до 40 изменений' };
  const text = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : null);
  const out = [];
  for (const c of list) {
    if (c?.kind === 'title' || c?.kind === 'about') {
      const v = text(c.value);
      const max = c.kind === 'title' ? limits.title : limits.about;
      if (!v || v.length > max || (c.kind === 'title' && v.length < 2)) return { error: `${c.kind}: пусто или длиннее ${max}` };
      out.push({ kind: c.kind, value: v });
    } else if (c?.kind === 'skills') {
      const seen = new Set();
      const skills = (Array.isArray(c.skills) ? c.skills : []).map(text).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
      if (!skills.length || skills.length > limits.keySkills || skills.some((s) => s.length > limits.keySkill)) {
        return { error: `skills: от 1 до ${limits.keySkills} навыков, каждый до ${limits.keySkill} знаков` };
      }
      out.push({ kind: 'skills', skills });
    } else if (c?.kind === 'place') {
      const hhId = Number(c.hhId);
      const position = text(c.position);
      const description = text(c.description);
      if (!Number.isSafeInteger(hhId) || hhId <= 0) return { error: 'place: нужен hhId места' };
      if (position === null && description === null) return { error: 'place: нечего менять' };
      if (position !== null && (!position || position.length > limits.position)) return { error: `place: должность пустая или длиннее ${limits.position}` };
      if (description !== null && (!description || description.length > limits.description)) {
        return { error: `place: описание пустое или длиннее ${limits.description}` };
      }
      out.push({ kind: 'place', hhId, ...(position !== null && { position }), ...(description !== null && { description }) });
    } else return { error: `неизвестный раздел: ${c?.kind}` };
  }
  return { changes: out };
}

// Навыки на hh → целевые: что убрать и что добавить (без разницы в регистре)
export function skillsDiff(current, target) {
  const key = (s) => String(s ?? '').trim().toLowerCase();
  const cur = new Set(current.map(key));
  const tgt = new Set(target.map(key));
  return { remove: current.filter((s) => !tgt.has(key(s))), add: target.filter((s) => !cur.has(key(s))) };
}

// Ответ hh на сохранение формы. resume — POST /applicant/resume/edit: 2xx и резюме в ответе (hasErrors — предупреждение:
// у резюме бывают незаполненные поля и кроме нашего); profile — сохранение опыта: 2xx, тело пустое (E0).
// body null — тело не дочитали (страница ушла сразу после ответа): принято по коду, итог проверит чтение резюме
export function writeResult(action, status, body) {
  if (!(status >= 200 && status < 300)) return { ok: false, note: errorCode(body) || `HTTP ${status || 'нет ответа'}` };
  if (action === 'resume' && body === null) return { ok: true, note: '' };
  if (action === 'resume') {
    const a = body?.resume?._attributes;
    if (!a) return { ok: false, note: 'hh ответил без резюме' };
    if (a.hasErrors) return { ok: true, note: 'hh пишет, что в резюме есть ошибки в полях' };
  }
  return { ok: true, note: '' };
}
