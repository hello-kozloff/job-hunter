// W1 · Parse vacancy — полная страница вакансии + правила, которым нужно описание.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы HTTP Request «Vacancy page» — в том же порядке, что строки из «Is candidate»
//       (строки уже в таблице, у каждой есть id).
// Выход: строка целиком с обновлёнными status / reasons / description / key_skills / has_test / contract / error
//        → нода Update пишет её обратно по id.

const rows = $('Is candidate').all().map((i) => i.json);
const responses = $input.all().map((i) => i.json);

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

// Описание вакансии: HTML → текст с переносами строк
const htmlToText = (html) =>
  decodeEntities(
    String(html ?? '')
      .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

// «Работа только из РФ». Совпавший кусок пишем в reasons, чтобы ложные срабатывания было видно
const RF_ONLY = [
  /(только|исключительно)[^.\n]{0,40}(из|на территории|в|по)\s+(рф|росси)/i,
  /(находит[а-яё]*|проживать|проживани[а-яё]*|нахождени[а-яё]*|располож[а-яё]*)[^.\n]{0,30}(в|на территории|из)\s+(рф|росси)/i,
  /(налогов[а-яё]*\s+)?резидент[а-яё]*\s+(рф|росси)/i,
  /(based|located|reside\w*|living)\s+in\s+russia/i,
];

function parsePage(res) {
  const html = String(res.data ?? res.body ?? '');
  if (res.statusCode !== 200) return { error: `страница: HTTP ${res.statusCode}` };
  const tpl = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
  if (!tpl) return { error: 'страница: нет HH-Lux-InitialState' };
  try {
    const state = JSON.parse(decodeEntities(tpl[1]));
    const v = state?.vacancyView?.vacancyFull?.vacancy;
    if (!v?.description) return { error: 'страница: нет описания' };
    return { v, test: state?.applicantVacancyResponseStatuses?.[String(v.vacancyId)]?.test };
  } catch (e) {
    return { error: `страница: ${e.message}` };
  }
}

return rows.map((row, i) => {
  const page = parsePage(responses[i] ?? {});
  // Страница не открылась — вакансию не теряем: остаётся new с ошибкой, видна в сообщении
  if (page.error) return { json: { ...row, error: page.error } };

  const { v, test } = page;
  if (String(v.vacancyId) !== row.external_id) {
    return { json: { ...row, error: `страница: пришла вакансия ${v.vacancyId}` } };
  }

  const description = htmlToText(v.description);
  const skills = (v.keySkills ?? []).join(', ');
  const contract = [
    ...(v.acceptLaborContract ? ['tk'] : []),
    ...(v.civilLawContracts ?? []).flatMap((c) => c?.civilLawContractsElement ?? (typeof c === 'string' ? [c] : [])).map((c) => String(c).toLowerCase()),
  ].join(',');

  const reasons = [];
  if (v.status?.archived || v.closedForApplicants) reasons.push('в архиве');
  const rf = RF_ONLY.map((re) => description.match(re)).find(Boolean);
  if (rf) reasons.push(`только из РФ: «${rf[0].trim()}»`);
  if (contract === 'tk') reasons.push('только ТК');
  if (!/react|next\.?js/i.test(`${row.title} ${skills} ${description}`)) reasons.push('нет React');

  return {
    json: {
      ...row,
      description: description.slice(0, 8000),
      key_skills: skills || row.key_skills,
      has_test: Boolean(test?.hasTests ?? row.has_test),
      contract,
      status: reasons.length ? 'rejected' : 'detailed',
      reasons: reasons.join(', '),
      error: '',
    },
  };
});
