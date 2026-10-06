// W1 · Parse search — разбор страниц поиска hh.ru в записи таблицы vacancies.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы HTTP Request «Search hh», по одному на страницу (Response Format = Text,
//       Include Response Headers and Status = on).
// Выход: ОДИН item —
//   { ok: true,  firstRun, vacancies: [...] }  → IF «OK?» → Split Out
//   { ok: false, reason, html }                → IF «OK?» → сохранить HTML → Stop and Error

const firstRun = Boolean($('Plan').first().json.firstRun);

// HTML-сущности раскодируем за один проход: иначе &amp;quot; станет кавычкой и сломает JSON
const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const stripTags = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const normTitle = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9+#]+/g, ' ')
    .trim();

const fail = (reason, html) => [{ json: { ok: false, reason, html: String(html ?? '') } }];

// Вакансия из выдачи → строка таблицы vacancies (имена полей = имена колонок)
function toRecord(v) {
  const pay = v.compensation ?? {};
  const companyId = v.company?.id ? String(v.company.id) : '';
  return {
    source: 'hh',
    external_id: String(v.vacancyId),
    // Одна вакансия в разных регионах = разные id. Склеиваем по компании и названию;
    // у скрытой компании id нет — такие не склеиваем
    dup_key: companyId ? `hh:${companyId}:${normTitle(v.name)}` : `hh:id:${v.vacancyId}`,
    title: String(v.name).trim(),
    company: String(v.company?.visibleName ?? v.company?.name ?? '').trim(),
    company_id: companyId,
    areas: v.area?.name ?? '',
    salary_from: pay.from ?? null,
    salary_to: pay.to ?? null,
    currency: pay.currencyCode ?? null,
    salary_gross: typeof pay.gross === 'boolean' ? pay.gross : null,
    experience: v.workExperience ?? '',
    employment_form: v.employmentForm ?? '',
    work_formats: (v.workFormats ?? []).flatMap((w) => w?.workFormatsElement ?? []).join(','),
    languages: (v.languages ?? [])
      .flatMap((l) => l?.language ?? [])
      .map((l) => `${l.isoCode}:${l.degree}`)
      .join(','),
    key_skills: stripTags(v.snippet?.skill),
    has_test: Boolean(v.userTestPresent),
    letter_required: Boolean(v['@responseLetterRequired']),
    responses: v.totalResponsesCount ?? null,
    snippet: [v.snippet?.req, v.snippet?.resp, v.snippet?.cond]
      .map(stripTags)
      .filter(Boolean)
      .join(' | ')
      .slice(0, 1500),
    url: `https://hh.ru/vacancy/${v.vacancyId}`,
    apply_url: `https://hh.ru/applicant/vacancy_response?vacancyId=${v.vacancyId}`,
    apply_type: 'hh',
    published_at: v.publicationTime?.$ ?? '',
    status: firstRun ? 'seen' : 'new',
  };
}

const byKey = new Map();
const seenIds = new Set();

for (const item of $input.all()) {
  const res = item.json;
  const html = String(res.body ?? res.data ?? '');

  if (res.statusCode !== 200) {
    const to = res.headers?.location ? ` → ${res.headers.location}` : '';
    return fail(`hh ответил HTTP ${res.statusCode}${to}`, html);
  }

  const tpl = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
  if (!tpl) {
    // Слово «captcha» есть и на нормальной странице, поэтому смотрим на него только без InitialState
    const hint = /captcha|робот/i.test(html) ? 'похоже на капчу/блок' : 'сменилась вёрстка?';
    return fail(`Нет HH-Lux-InitialState — ${hint}`, html);
  }

  let state;
  try {
    state = JSON.parse(decodeEntities(tpl[1]));
  } catch (e) {
    return fail(`InitialState не разбирается: ${e.message}`, html);
  }

  const list = state?.vacancySearchResult?.vacancies;
  if (!Array.isArray(list)) return fail('Нет vacancySearchResult.vacancies — сменилась структура', html);

  for (const v of list) {
    if (!v?.vacancyId || !v?.name) return fail('У вакансии нет vacancyId/name — сменилась структура', html);
    const id = String(v.vacancyId);
    // Между запросами страниц вакансия может съехать со страницы 0 на страницу 1
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const rec = toRecord(v);
    const prev = byKey.get(rec.dup_key);
    if (!prev) byKey.set(rec.dup_key, rec);
    else if (rec.areas && !prev.areas.split(', ').includes(rec.areas)) prev.areas += `, ${rec.areas}`;
  }
}

// Пустая выдача по нашему запросу не бывает — считаем поломкой
if (byKey.size === 0) return fail('В выдаче 0 вакансий — сменилась структура или запрос', $input.first().json.body);

return [{ json: { ok: true, firstRun, vacancies: [...byKey.values()] } }];
