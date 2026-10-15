// Разделы резюме (W13, 15.10.2026, docs/recommendations.md → «Разделы резюме»): разметка поверх текста.
// Подключение: «// @include n8n/shared/cv.js» сразу после n8n/shared/resume.js (locateSnippet, normMap).
//
// Текст резюме (profile.resume) остаётся как есть — разделы это именованные куски текста. Настройка cv хранит текст
// с метками вместо кусков (template) и сами куски:
//   ⟦title⟧, ⟦about⟧ — должность и «О себе» резюме (cv.resumes[i]: несколько резюме заложены, пока одно);
//   ⟦p:e1⟧, ⟦d:e1⟧ — должность и описание места работы (cv.places — общие для всех резюме: на hh опыт работы хранится
//   в профиле, E0). Компания и даты места остаются в тексте вокруг меток: личные факты, их не правим.
// cvRender(cv) === profile.resume — иначе разметка устарела (резюме переписал W11 или импорт): W13 работает с текстом.
// keySkills резюме — ключевые навыки для hh (≤ 30, выбирает человек); в текст не попадают: навык из пет-проекта в общем
// списке W5 счёл бы коммерческим опытом.

const CV_MARK = /⟦(title|about|[pd]:e\d{1,3})⟧/g;
const CV_BAD = /[⟦⟧]/;

// Значение поля по ключу метки
function cvField(cv, key, i = 0) {
  if (key === 'title' || key === 'about') return cv.resumes[i][key];
  const place = cv.places.find((p) => p.id === key.slice(2));
  return (key[0] === 'p' ? place?.position : place?.description) ?? '';
}

// Текст резюме из разметки
const cvRender = (cv, i = 0) => cv.resumes[i].template.replace(CV_MARK, (m, key) => cvField(cv, key, i));

// Разметка жива: рендер совпадает с profile.resume (так же без пробелов по краям, как resumeDraft)
function cvFresh(s) {
  try {
    return Boolean(s.cv?.resumes?.length) && cvRender(s.cv) === String(s['profile.resume'] ?? '').trim();
  } catch {
    return false;
  }
}

// Куски отрендеренного текста по порядку: { key: title | about | p:e1 | d:e1 | text, start, end, t } — t: где кусок
// text начинается в template (длина у него та же)
function cvLayout(cv, i = 0) {
  const tpl = cv.resumes[i].template;
  const parts = [];
  let pos = 0;
  let last = 0;
  for (const m of tpl.matchAll(CV_MARK)) {
    if (m.index > last) {
      parts.push({ key: 'text', start: pos, end: pos + m.index - last, t: last });
      pos += m.index - last;
    }
    const len = cvField(cv, m[1], i).length;
    parts.push({ key: m[1], start: pos, end: pos + len });
    pos += len;
    last = m.index + m[0].length;
  }
  if (tpl.length > last) parts.push({ key: 'text', start: pos, end: pos + tpl.length - last, t: last });
  return parts;
}

// Раздел, в котором целиком лежит кусок at = { start, end } текста, или null — кусок задевает два раздела
const cvPartAt = (cv, at, i = 0) => cvLayout(cv, i).find((p) => p.end > p.start && at.start >= p.start && at.end <= p.end) ?? null;

// Поменять кусок at текста на next → { cv, section } или { error: cross | mark }: правится поле раздела или текст
// вокруг меток (template). Исходный cv не меняется
function cvApply(cv, at, next, i = 0) {
  if (CV_BAD.test(next)) return { error: 'mark' };
  const part = cvPartAt(cv, at, i);
  if (!part) return { error: 'cross' };
  const off = at.start - part.start;
  const cut = (s) => s.slice(0, off) + next + s.slice(off + at.end - at.start);
  const copy = JSON.parse(JSON.stringify(cv));
  const r = copy.resumes[i];
  if (part.key === 'text') {
    r.template = r.template.slice(0, part.t) + cut(r.template.slice(part.t, part.t + part.end - part.start)) + r.template.slice(part.t + part.end - part.start);
  } else if (part.key === 'title' || part.key === 'about') r[part.key] = cut(r[part.key]);
  else {
    const place = copy.places.find((p) => p.id === part.key.slice(2));
    const field = part.key[0] === 'p' ? 'position' : 'description';
    place[field] = cut(place[field]);
  }
  return { cv: copy, section: part.key };
}

// Раздел опыта работы (общий для всех резюме)
const cvShared = (section) => /^[pd]:/.test(String(section ?? ''));

// Подпись раздела для Telegram (без HTML): «Должность», «💼 Руб Икс — описание»… или '' — текст вне разделов
function cvSectionName(cv, section) {
  if (section === 'title') return 'Должность';
  if (section === 'about') return '«О себе»';
  if (section === 'extra') return '«Дополнительно»';
  if (!cvShared(section)) return '';
  const place = cv?.places.find((p) => p.id === section.slice(2));
  return `💼 ${place?.company || 'Место работы'} — ${section[0] === 'p' ? 'должность' : 'описание'}`;
}

// ---------- Разметка из якорей нейросети (режим split) ----------

// Первое вхождение needle в [lo, hi) — дословно или без разницы в пробелах, кавычках и тире (как locateSnippet).
// Первое, а не единственное: желаемая должность в PDF hh часто совпадает с должностью на последнем месте работы, а
// места идут по порядку — каждое ищется от конца прошлого. Потерю текста ловит проверка рендером
function cvFind(text, needle, lo = 0, hi = text.length) {
  const area = text.slice(lo, hi);
  const at = locateSnippet(area, needle);
  if (at.error !== 'many') return at.error ? at : { start: lo + at.start, end: lo + at.end };
  const i = area.indexOf(String(needle));
  if (i >= 0) return { start: lo + i, end: lo + i + String(needle).length };
  const m = normMap(area);
  const n = normMap(String(needle).trim()).out;
  const k = m.out.indexOf(n);
  return { start: lo + m.pos[k], end: lo + m.pos[k + n.length - 1] + 1 };
}
// Последнее дословное вхождение в [lo, hi) (ближайшее к hi), иначе — как cvFind
function cvLast(text, needle, lo, hi) {
  const i = text.lastIndexOf(String(needle), hi - String(needle).length);
  return i >= lo ? { start: i, end: i + String(needle).length } : cvFind(text, needle, lo, hi);
}
// Кусок from…to: начало from в [lo, hi), конец — первое to после него. → { start, end } или { error }
function cvSpan(text, from, to, lo = 0, hi = text.length) {
  const a = cvFind(text, from, lo, hi);
  if (a.error) return a;
  const b = cvFind(text, to, a.start, hi);
  return b.error ? b : { start: a.start, end: b.end };
}

// a = { title, about: { from, to }, places: [{ company, period, position, from, to }] } — всё дословно из text.
// Описание места — от from до to; компания, даты и должность ищутся в заголовке места: между концом прошлого места и
// началом описания (должность может встретиться и в «О себе»). Не нашлось — раздел остаётся текстом, причина — в
// problems. → { cv, problems } или { error: mark | lossy }
function cvFromAnchors(text, a) {
  if (CV_BAD.test(text)) return { error: 'mark' };
  const problems = [];
  const ranges = [];
  const free = (r) => !ranges.some((x) => r.start < x.end && x.start < r.end);
  const take = (key, r, label) => {
    if (r.error) problems.push(`${label}: не нашёл в тексте`);
    else if (!free(r) || r.end <= r.start) problems.push(`${label}: пересекается с другим разделом`);
    else {
      ranges.push({ key, ...r });
      return true;
    }
    return false;
  };
  if (a?.title) take('title', cvFind(text, a.title), 'должность');
  if (a?.about?.from && a?.about?.to) take('about', cvSpan(text, a.about.from, a.about.to), '«О себе»');
  const places = [];
  let lo = 0;
  for (const p of Array.isArray(a?.places) ? a.places.slice(0, 30) : []) {
    const company = String(p?.company ?? '').trim();
    const label = `место «${company || '?'}»`;
    const id = `e${places.length + 1}`;
    const d = p?.from && p?.to ? cvSpan(text, p.from, p.to, lo) : { error: 'none' };
    if (d.error) {
      problems.push(`${label}: не нашёл описание`);
      continue;
    }
    // Заголовок места — от компании (последнее её упоминание перед описанием) до описания; компании дословно нет —
    // 300 знаков перед описанием
    const c = company ? text.lastIndexOf(company, d.start) : -1;
    const head = c >= lo ? Math.max(lo, c - 200) : Math.max(lo, d.start - 300);
    // Должность — после компании («### Компания — Должность», в PDF hh — строкой ниже), иначе ближайшая перед ней
    let pos = { error: 'none' };
    if (p?.position && c >= lo) {
      pos = cvFind(text, p.position, c, d.start);
      if (pos.error) pos = cvLast(text, p.position, head, c);
    } else if (p?.position) pos = cvLast(text, p.position, head, d.start);
    if (pos.error) {
      problems.push(`${label}: не нашёл должность`);
      continue;
    }
    if (!free(pos) || !free(d)) {
      problems.push(`${label}: пересекается с другим разделом`);
      continue;
    }
    ranges.push({ key: `p:${id}`, ...pos }, { key: `d:${id}`, ...d });
    const period = String(p?.period ?? '').trim();
    places.push({
      id,
      hhId: null,
      company: company && c >= lo ? company : '',
      period: period && text.slice(head, d.start).includes(period) ? period : '',
      position: text.slice(pos.start, pos.end),
      description: text.slice(d.start, d.end),
    });
    lo = d.end;
  }
  ranges.sort((x, y) => x.start - y.start);
  let template = '';
  let last = 0;
  for (const r of ranges) {
    template += `${text.slice(last, r.start)}⟦${r.key}⟧`;
    last = r.end;
  }
  template += text.slice(last);
  const field = (key) => {
    const r = ranges.find((x) => x.key === key);
    return r ? text.slice(r.start, r.end) : '';
  };
  const cv = {
    v: 1,
    places,
    resumes: [{ id: 'r1', hh: null, template, title: field('title'), about: field('about'), keySkills: [] }],
  };
  return cvRender(cv) === text ? { cv, problems } : { error: 'lossy' };
}
