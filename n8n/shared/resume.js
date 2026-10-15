// Рекомендации по резюме (W13, 15.10.2026, docs/recommendations.md): правки резюме и навыки вакансий.
// Общий код W13: строка «// @include n8n/shared/resume.js» после n8n/shared/card.js (esc), n8n/shared/settings.js
// (SETTINGS) и n8n/shared/skills.js (skillVariants), сразу за ней — n8n/shared/cv.js (разделы резюме).
//
// Резюме бота — profile.resume и profile.extra (что человек дописал сам). Нейросеть видит их одним текстом, как W2 и W5
// (resumeText): резюме, «## Дополнительно», extra. Правка — { where, old, new, why }: old — кусок этого текста дословно.
// Код находит его ровно один раз, сам решает, добавление это или замена, и применяет к черновику.
// Есть разметка (cv, n8n/shared/cv.js) — правка меняет поле своего раздела, текст резюме собирается рендером.

const EXTRA_HEAD = '\n\n## Дополнительно\n';

// Черновик из настроек: { resume, extra } без пробелов по краям — так их видит resumeText; cv — разметка, если она
// совпадает с текстом (иначе null: правки — по тексту, как без разметки)
const resumeDraft = (s) => ({
  resume: String(s['profile.resume'] ?? '').trim(),
  extra: String(s['profile.extra'] ?? '').trim(),
  cv: cvFresh(s) ? s.cv : null,
});
// Один текст — как resumeText(s): его видит нейросеть, в нём ищутся правки
const resumeJoin = (d) => (d.extra ? `${d.resume}${EXTRA_HEAD}${d.extra}` : d.resume);
// Отпечаток версии: резюме поменялось за время сессии (новый PDF в W11) — правки не сохраняем
function resumeHash(d) {
  let h = 5381;
  for (const ch of `${d.resume}\u0000${d.extra}`) h = (Math.imul(h, 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}
// Строка без переносов, не длиннее n
const oneLine = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ---------- Поиск куска текста ----------

// Нормализация для поиска: пробелы подряд → один, кавычки → ", тире → -, ё → е, маркеры списка → -.
// out — строка, pos — позиция каждого её знака в исходнике
function normMap(text) {
  let out = '';
  const pos = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (/\s/.test(c)) {
      if (!space && out.length) {
        out += ' ';
        pos.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    if ('«»“”„"'.includes(c)) c = '"';
    else if ('—–‒−'.includes(c)) c = '-';
    else if (c === '•' || c === '·') c = '-';
    else if (c === 'ё') c = 'е';
    else if (c === 'Ё') c = 'Е';
    out += c;
    pos.push(i);
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1);
    pos.pop();
  }
  return { out, pos };
}

// Где в тексте кусок old: { start, end } — позиции в исходнике, или { error: none | many }
function locateSnippet(text, old) {
  const needle = String(old ?? '');
  if (!needle.trim()) return { error: 'none' };
  const first = text.indexOf(needle);
  if (first >= 0) return text.indexOf(needle, first + 1) >= 0 ? { error: 'many' } : { start: first, end: first + needle.length };
  // Нейросеть поменяла пробелы, кавычки или тире — ищем без них и переводим обратно в позиции исходника
  const t = normMap(text);
  const n = normMap(needle.trim()).out;
  const at = n ? t.out.indexOf(n) : -1;
  if (at < 0) return { error: 'none' };
  if (t.out.indexOf(n, at + 1) >= 0) return { error: 'many' };
  return { start: t.pos[at], end: t.pos[at + n.length - 1] + 1 };
}

// В какой части черновика кусок: resume, extra или null — задевает обе или заголовок «Дополнительно»
function partOf(d, at) {
  if (at.end <= d.resume.length) return 'resume';
  if (d.extra && at.start >= d.resume.length + EXTRA_HEAD.length) return 'extra';
  return null;
}

// ---------- Правка ----------

// Слова для сравнения: без регистра и знаков препинания по краям («React.» = «react», «Next.js» и «C++» — целиком)
const patchWords = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .match(/[\p{L}\p{N}](?:[\p{L}\p{N}.+#-]*[\p{L}\p{N}+#])?/gu) ?? [];

// Добавление — все слова old по порядку остались в new. Иначе замена: что-то из старого текста пропадёт
function isAddition(old, next) {
  const a = patchWords(old);
  let i = 0;
  for (const w of patchWords(next)) if (i < a.length && w === a[i]) i++;
  return i === a.length;
}

const PATCH_MAX = 1500;
const PATCH_ERRORS = {
  none: 'не нашёл это место в тексте',
  many: 'такой кусок встречается в тексте несколько раз',
  same: 'правка ничего не меняет',
  long: 'слишком длинная правка',
  edge: 'правка задевает и резюме, и «Дополнительно»',
  cross: 'правка задевает два раздела резюме',
  scope: 'правка не про опыт работы',
  mark: 'в правке служебные знаки ⟦ ⟧',
  limit: 'резюме вышло бы длиннее предела',
  overlap: 'то же место уже правит другая правка',
};

// Правка нейросети → { where, old, new, why, kind: add | replace, section, start, end } (old — точный кусок исходника)
// или { error }. section — раздел (n8n/shared/cv.js: title, about, p:e1, d:e1) или text, extra. Пустой old и where
// «Дополнительно» — новая строка в конец profile.extra (append): у человека, который «Дополнительно» ещё не писал, свои
// проекты больше некуда вписать. scope experience — только правки опыта работы (Upgrade из «💼 Опыт работы»)
function checkPatch(d, p, scope = '') {
  const old = String(p?.old ?? '');
  const next = String(p?.new ?? '').trim();
  const where = oneLine(p?.where, 60) || 'Резюме';
  if (CV_BAD.test(next)) return { error: 'mark' };
  if (!old.trim()) {
    if (!/дополнительно/i.test(where) || !next) return { error: 'none' };
    if (next.length > PATCH_MAX) return { error: 'long' };
    if (scope === 'experience') return { error: 'scope' };
    return { where, old: '', new: next, why: oneLine(p?.why, 200), kind: 'add', section: 'extra', append: 'extra', start: -1, end: -1 };
  }
  if (normMap(old).out === normMap(next).out) return { error: 'same' };
  if (next.length > PATCH_MAX || old.length > PATCH_MAX * 2) return { error: 'long' };
  const text = resumeJoin(d);
  const at = locateSnippet(text, old);
  if (at.error) return { error: at.error };
  const part = partOf(d, at);
  if (!part) return { error: 'edge' };
  let section = part === 'extra' ? 'extra' : 'text';
  if (part === 'resume' && d.cv) {
    const c = cvPartAt(d.cv, at);
    if (!c) return { error: 'cross' };
    section = c.key;
  }
  if (scope === 'experience' && !cvShared(section)) return { error: 'scope' };
  // old — точный кусок исходника: нейросеть могла поменять в нём пробелы или кавычки, применять будем к исходнику
  const exact = text.slice(at.start, at.end);
  return {
    where,
    old: exact,
    new: next,
    why: oneLine(p?.why, 200),
    kind: isAddition(exact, next) ? 'add' : 'replace',
    section,
    start: at.start,
    end: at.end,
  };
}

// Правки нейросети → { patches, dropped: [{ where, error }] }: проверенные, без пересечений, не больше max
function checkPatches(d, list, max = 8, scope = '') {
  const patches = [];
  const dropped = [];
  for (const p of (Array.isArray(list) ? list : []).slice(0, max * 2)) {
    const c = checkPatch(d, p, scope);
    if (c.error) dropped.push({ where: oneLine(p?.where, 60) || 'Резюме', error: c.error });
    else if (!c.append && patches.some((x) => c.start < x.end && x.start < c.end)) dropped.push({ where: c.where, error: 'overlap' });
    else if (patches.length < max) patches.push(c);
  }
  return { patches, dropped };
}

// Применить правку к черновику: old ищется заново — прошлая правка могла его поменять. → { draft } или { error }
function applyPatch(d, p) {
  if (p.append === 'extra') {
    const extra = d.extra ? `${d.extra}\n${p.new}` : p.new;
    return extra.length > SETTINGS['profile.extra'].text ? { error: 'limit' } : { draft: { ...d, extra } };
  }
  const at = locateSnippet(resumeJoin(d), p.old);
  if (at.error) return { error: at.error };
  const part = partOf(d, at);
  if (!part) return { error: 'edge' };
  if (part === 'resume' && d.cv) {
    // Разметка: правится поле раздела (или текст вокруг меток), текст резюме — рендер
    const r = cvApply(d.cv, at, p.new);
    if (r.error) return r;
    const resume = cvRender(r.cv);
    return resume.length > SETTINGS['profile.resume'].text ? { error: 'limit' } : { draft: { ...d, resume, cv: r.cv } };
  }
  const offset = part === 'resume' ? 0 : d.resume.length + EXTRA_HEAD.length;
  const src = d[part];
  const value = src.slice(0, at.start - offset) + p.new + src.slice(at.end - offset);
  const limit = SETTINGS[part === 'resume' ? 'profile.resume' : 'profile.extra'].text;
  if (value.length > limit) return { error: 'limit' };
  return { draft: { ...d, [part]: value } };
}

// ---------- Дифф для Telegram ----------

// Пословный дифф (HTML): <s>убрал</s> <b>добавил</b>; длинные куски без изменений сжаты до «…» с context словами вокруг
function wordDiff(old, next, context = 8, max = 1800) {
  const a = String(old ?? '').split(/\s+/).filter(Boolean);
  const b = String(next ?? '').split(/\s+/).filter(Boolean);
  const key = (w) => patchWords(w).join(' ') || w;
  const ka = a.map(key);
  const kb = b.map(key);
  // LCS: dp[i][j] — длина общей подпоследовательности хвостов a[i:] и b[j:]
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ka[i] === kb[j]) {
      ops.push(['=', b[j++]]);
      i++;
    } else if (i < a.length && (j >= b.length || dp[i + 1][j] >= dp[i][j + 1])) ops.push(['-', a[i++]]);
    else ops.push(['+', b[j++]]);
  }
  // Склеить подряд идущие слова одного вида
  const runs = [];
  for (const [t, w] of ops) {
    if (runs.at(-1)?.[0] === t) runs.at(-1)[1].push(w);
    else runs.push([t, [w]]);
  }
  const html = runs
    .map(([t, words], n) => {
      if (t === '-') return `<s>${esc(words.join(' '))}</s>`;
      if (t === '+') return `<b>${esc(words.join(' '))}</b>`;
      const first = n === 0;
      const last = n === runs.length - 1;
      const keep = (first ? 0 : context) + (last ? 0 : context);
      if (words.length <= keep + 3) return esc(words.join(' '));
      const head = first ? [] : words.slice(0, context);
      const tail = last ? [] : words.slice(-context);
      return [...head, '…', ...tail].map(esc).join(' ');
    })
    .join(' ');
  return html.length > max ? `${html.slice(0, max).replace(/<[^>]*$/, '')}…` : html;
}

// ---------- Навыки вакансий ----------

// Вакансии, которые человек выбрал или выбрал бы: ✅ 🤔 📨 или решения нет, а нейросеть сказала apply
const isTargetRow = (r) => ['apply', 'maybe', 'earlier'].includes(r.my_decision) || (!r.my_decision && r.decision === 'apply');
// Ключ навыка для подсчёта: «React.js» = «ReactJS» = «react», «HTML5» = «HTML», «postgres» = «PostgreSQL»
const SKILL_SYNONYMS = { postgres: 'postgresql', kuber: 'kubernetes', k8s: 'kubernetes' };
function skillKey(skill) {
  const s = String(skill ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const base = (s.length > 3 ? s.replace(/\.?js$/, '') : s).replace(/^([a-z][a-z.+#-]{2,})\d+$/, '$1');
  return SKILL_SYNONYMS[base] ?? base;
}
// Есть ли навык в тексте резюме (в нижнем регистре): как mentionsSkill, но с номером версии после — «HTML» есть в
// «HTML5/CSS3», «CSS» — тоже
const hasSkill = (text, name) =>
  skillVariants(name).some((v) =>
    new RegExp(`(^|[^a-zа-яё0-9])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d*([^a-zа-яё0-9]|$)`).test(text),
  );

// Навыки вакансий против резюме. rows — строки vacancies, text — резюме одним текстом.
// → { basis: target | passed | null, vacancies, coverage (0–1 или null), top: [{ name, freq, has }], missing }
//   basis target — вакансии, которые человек выбрал (их меньше 10 — passed: все, что прошли фильтр).
//   coverage — доля частот навыков из top, которые есть в резюме
function skillStats(rows, text, top = 30) {
  const withSkills = (rows ?? []).filter((r) => r?.key_skills);
  let basis = 'target';
  let list = withSkills.filter(isTargetRow);
  if (list.length < 10) {
    basis = 'passed';
    list = withSkills.filter((r) => !['rejected', 'seen'].includes(r.status));
  }
  if (!list.length) return { basis: null, vacancies: 0, coverage: null, top: [], missing: [] };
  const counts = new Map();
  for (const r of list) {
    const seen = new Set();
    for (const raw of String(r.key_skills).split(',').map((x) => x.trim()).filter(Boolean)) {
      const key = skillKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const c = counts.get(key) ?? { freq: 0, names: new Map() };
      c.freq++;
      c.names.set(raw, (c.names.get(raw) ?? 0) + 1);
      counts.set(key, c);
    }
  }
  const low = String(text ?? '').toLowerCase();
  const skills = [...counts.values()]
    .map((c) => {
      const names = [...c.names.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n);
      return { name: names[0], freq: c.freq, has: names.some((n) => hasSkill(low, n)) };
    })
    .sort((x, y) => y.freq - x.freq || x.name.localeCompare(y.name))
    .slice(0, top);
  const total = skills.reduce((n, x) => n + x.freq, 0);
  const got = skills.reduce((n, x) => n + (x.has ? x.freq : 0), 0);
  return { basis, vacancies: list.length, coverage: total ? got / total : null, top: skills, missing: skills.filter((x) => !x.has) };
}

const percent = (x) => `${Math.round((x ?? 0) * 100)}%`;

// Частые слова в названиях подходящих вакансий (анализ: как называть должность) → [{ word, freq }]
const TITLE_STOP = new Set(['в', 'на', 'и', 'с', 'по', 'для', 'к', 'из', 'от', 'до', 'или', 'the', 'of', 'and', 'to', 'in', 'for', 'a']);
function titleWords(rows, top = 12) {
  const list = (rows ?? []).filter(isTargetRow);
  const counts = new Map();
  for (const r of list.length >= 10 ? list : (rows ?? []).filter((x) => !['rejected', 'seen'].includes(x?.status))) {
    const words = new Set(String(r?.title ?? '').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}][\p{L}\p{N}.+#-]*/gu) ?? []);
    for (const w of words) if (!TITLE_STOP.has(w) && w.length > 1) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([word, freq]) => ({ word, freq }));
}
