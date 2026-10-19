// W1 · Parse vacancy — полная страница вакансии + правила, которым нужно описание.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы HTTP Request «Vacancy page» — в том же порядке, что строки из «Candidates»
//       (строки уже в таблице, у каждой есть id: этого сбора и хвост очереди new).
// Выход: строка целиком с обновлёнными status / reasons / description / key_skills / has_test / contract / error
//        → нода Update пишет её обратно по id. Дальше строки status = detailed оценивает нейросеть (W2).

const rows = $('Candidates').all().map((i) => i.json);
const responses = $input.all().map((i) => i.json);

// @include n8n/shared/hh.js

// @include n8n/shared/ai.js

// @include n8n/shared/settings.js

// @include n8n/shared/resumes.js

// Правила, выключенные в настройках бота (⚙️ → 🧹 Фильтр → Правила): only_rf, no_stack. «Нет React и Vue» — только
// у пресета frontend (13.10.2026). Несколько резюме: пресет и выключенные правила — свои у каждого резюме (вакансия
// несёт resume_id; пусто — основное)
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
// Отрицание перед совпадением в той же части фразы (до запятой) — наоборот, работать из РФ нельзя или не обязательно:
// «нельзя находиться в РФ», «не только из России», «не обязательно быть резидентом РФ» (19.10.2026). Правило включено
// у тех, кто живёт не в РФ, — им такие вакансии и нужны
const NEGATION = /(^|[^а-яёa-z])(не|нельзя|запрещ[а-яё]*|кроме|исключая|вне|not|outside)([^а-яёa-z]|$)/i;
const negated = (text, at) => NEGATION.test(text.slice(Math.max(0, at - 60), at).split(/[.!?;:,\n]/).pop());
// Первое совпадение без отрицания: «не только сайты, работа только из РФ» — второе «только» тоже проверяем
function rfOnly(text) {
  for (const re of RF_ONLY) {
    const all = new RegExp(re.source, 'gi');
    let m;
    while ((m = all.exec(text))) {
      if (!negated(text, m.index)) return m;
      all.lastIndex = m.index + 1;
    }
  }
  return null;
}

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
  const rf = rfOnly(description);
  if (rf && !off.has('only_rf')) reasons.push(`только из РФ: «${rf[0].trim()}»`);
  // Vue (и Nuxt) — тоже наш стек с 07.10.2026: только Vue нейросеть оценит как maybe.
  // AI-вакансии (разработка на LLM) без React и Vue берём на любом языке (19.10.2026, решение пользователя; до того —
  // только на JS/TS, «AI не на JS/TS»): язык и остальное решает нейросеть
  const stack = `${row.title} ${skills} ${description}`;
  if (!off.has('no_stack') && !/react|next\.?js|vue|nuxt/i.test(stack) && !isAi(`${row.title} ${skills || row.key_skills}`)) {
    reasons.push('нет React и Vue');
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
