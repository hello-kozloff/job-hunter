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

// @include n8n/shared/settings.js

// @include n8n/shared/resumes.js

// Правила, выключенные в настройках бота (⚙️ → 🧹 Фильтр → Правила): only_rf, no_stack. «Нет React и Vue» и
// «AI не на JS/TS» — только у пресета frontend (13.10.2026). Несколько резюме: пресет и выключенные правила — свои
// у каждого резюме (вакансия несёт resume_id; пусто — основное)
const settings = loadSettings($('Settings').all());
const offByResume = new Map();
function offFor(resumeId) {
  const id = resumeId && resumeById(settings, resumeId) ? resumeId : 'r1';
  if (!offByResume.has(id)) {
    const rs = resumeSettings(settings, id);
    const off = new Set(rs['filter.rules_off']);
    if (!('no_stack' in filterRulesFor(rs['profile.preset']))) off.add('no_stack');
    offByResume.set(id, off);
  }
  return offByResume.get(id);
}

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

  const off = offFor(row.resume_id);
  const description = htmlToText(v.description);
  const skills = (v.keySkills ?? []).join(', ');
  const contract = contractOf(v);

  const reasons = [];
  if (v.status?.archived || v.closedForApplicants) reasons.push('в архиве');
  const rf = RF_ONLY.map((re) => description.match(re)).find(Boolean);
  if (rf && !off.has('only_rf')) reasons.push(`только из РФ: «${rf[0].trim()}»`);
  // Vue (и Nuxt) — тоже наш стек с 07.10.2026: только Vue нейросеть оценит как maybe.
  // AI-вакансии (разработка на LLM) без React и Vue берём, только если в них JS/TS (решения пользователя 07.10.2026)
  const stack = `${row.title} ${skills} ${description}`;
  if (!off.has('no_stack') && !/react|next\.?js|vue|nuxt/i.test(stack)) {
    if (!isAi(`${row.title} ${skills || row.key_skills}`)) reasons.push('нет React и Vue');
    else if (!JS_STACK.test(stack)) reasons.push('AI не на JS/TS');
  }

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
