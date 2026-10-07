// W1 · Parse vacancy — полная страница вакансии + правила, которым нужно описание.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы HTTP Request «Vacancy page» — в том же порядке, что строки из «Is candidate»
//       (строки уже в таблице, у каждой есть id).
// Выход: строка целиком с обновлёнными status / reasons / description / key_skills / has_test / contract / error
//        → нода Update пишет её обратно по id. Дальше строки status = detailed оценивает нейросеть (W2).

const rows = $('Is candidate').all().map((i) => i.json);
const responses = $input.all().map((i) => i.json);

// @include n8n/shared/hh.js

// @include n8n/shared/ai.js

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

return rows.map((row, i) => {
  const page = parsePage(responses[i] ?? {});
  // Страница не открылась — вакансию не теряем: W2 оценит её по фрагменту из выдачи, ошибка видна в карточке
  if (page.error) return { json: { ...row, status: 'detailed', error: page.error } };

  const { v, test } = page;
  if (String(v.vacancyId) !== row.external_id) {
    return { json: { ...row, status: 'detailed', error: `страница: пришла вакансия ${v.vacancyId}` } };
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
  // Vue (и Nuxt) — тоже наш стек с 07.10.2026: только Vue нейросеть оценит как maybe.
  // AI-вакансии (разработка на LLM) берём на любом стеке — решение пользователя 07.10.2026
  const ai = isAi(`${row.title} ${skills || row.key_skills}`);
  if (!ai && !/react|next\.?js|vue|nuxt/i.test(`${row.title} ${skills} ${description}`)) reasons.push('нет React и Vue');

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
