// W1 · Parse search — разбор страниц поиска hh.ru в записи таблицы vacancies.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы HTTP Request «Search hh», по одному на страницу (Response Format = Text,
//       Include Response Headers and Status = on).
// Выход: ОДИН item —
//   { ok: true, vacancies: [...], requests: [...] }  → IF «OK?» → Split Out
//   { ok: false, reason, html }                                → IF «OK?» → сохранить HTML → Stop and Error
// requests — запросы поиска для сообщения о сборе: { label, page, status, total (нашёл hh), count (на странице) }
// Пустая выдача — не поломка, если hh сам сказал «найдено 0» (узкая профессия в одном городе за сутки)

const plan = $('Plan').all().map((i) => i.json);

// HTML-сущности раскодируем за один проход: иначе &amp;quot; станет кавычкой и сломает JSON
const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: '\u00a0' };
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
// Текст ответа HTTP Request (Response Format = Text) n8n кладёт в поле data
const htmlOf = (res) => String(res.data ?? res.body ?? '');

// Формы оформления: tk = трудовой договор + SELF_EMPLOYED / INDIVIDUAL_ENTREPRENEUR / INDIVIDUAL_PERSON (ГПХ).
// Пустая строка = работодатель не указал
const contractOf = (v) =>
  [
    ...(v.acceptLaborContract ? ['tk'] : []),
    ...(v.civilLawContracts ?? []).flatMap((c) => c?.civilLawContractsElement ?? []).map((c) => c.toLowerCase()),
  ].join(',');

// Вакансия из выдачи → строка таблицы vacancies (имена полей = имена колонок)
// resumeId — резюме, чьим поиском найдена вакансия (пусто у основного: колонка resume_id тогда не пишется);
// resumeName — его название, пока резюме больше одного (у основного тоже), иначе пусто и колонка не пишется
function toRecord(v, resumeId = '', resumeName = '') {
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
    contract: contractOf(v),
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
    status: 'new',
    ...(resumeId ? { resume_id: resumeId } : {}),
    ...(resumeName ? { resume_name: resumeName } : {}),
  };
}

const byKey = new Map();
const seenIds = new Set();
const requests = [];

for (const [index, item] of $input.all().entries()) {
  const res = item.json;
  const html = htmlOf(res);

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
  requests.push({
    label: plan[index]?.label ?? '',
    page: plan[index]?.page ?? index,
    status: res.statusCode,
    total: state.vacancySearchResult.totalResults ?? null,
    count: list.length,
  });

  for (const v of list) {
    if (!v?.vacancyId || !v?.name) return fail('У вакансии нет vacancyId/name — сменилась структура', html);
    const id = String(v.vacancyId);
    // Между запросами страниц вакансия может съехать со страницы 0 на страницу 1
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const rec = toRecord(v, plan[index]?.resumeId ?? '', plan[index]?.resumeName ?? '');
    const prev = byKey.get(rec.dup_key);
    if (!prev) byKey.set(rec.dup_key, rec);
    else if (rec.areas && !prev.areas.split(', ').includes(rec.areas)) prev.areas += `, ${rec.areas}`;
  }
}

// Пустая выдача — поломка, если hh не сказал «найдено 0»: значит, вакансии есть, а мы их не нашли в разметке
if (byKey.size === 0 && requests.some((r) => r.total !== 0)) {
  return fail('В выдаче 0 вакансий — сменилась структура или запрос', htmlOf($input.first().json));
}

return [{ json: { ok: true, vacancies: [...byKey.values()], requests } }];
