// W3 · Rescue parse — страница вакансии, отсеянной фильтром, перед решением с панели (08.10.2026).
// Нода: Code, режим «Run Once for All Items».
// Отсеянные по выдаче страницу не открывали — описания нет, а оно нужно письму (✅) и нейросети (🤖 На оценку).
// Вход: ответ HTTP Request «Rescue page»; строка — из «Vacancy».
// Выход: { id, description, key_skills, has_test, contract, error, closed } → «Save page» (запись по id) → «Apply choice».
//   Страница не открылась — решение всё равно принимаем: письмо и оценка пойдут по фрагменту, ошибка видна в карточке.
//   closed — вакансия в архиве или закрыта для откликов: «Apply choice» поставит «🔒 закрыта».
//   Правила фильтра по странице не применяем: пользователь сам решил вернуть вакансию.

// @include n8n/shared/hh.js

const row = $('Vacancy').first().json;
let page = parsePage($input.first().json);
if (!page.error && String(page.v.vacancyId) !== String(row.external_id)) {
  page = { error: `страница: пришла вакансия ${page.v.vacancyId}` };
}

if (page.error) {
  return [
    {
      json: {
        id: row.id,
        description: row.description ?? '',
        key_skills: row.key_skills ?? '',
        has_test: Boolean(row.has_test),
        contract: row.contract ?? '',
        error: page.error,
        closed: false,
      },
    },
  ];
}

const { v, test } = page;
const skills = (v.keySkills ?? []).join(', ');
return [
  {
    json: {
      id: row.id,
      description: htmlToText(v.description).slice(0, 8000),
      key_skills: skills || row.key_skills || '',
      has_test: Boolean(test?.hasTests ?? row.has_test),
      contract: contractOf(v),
      error: '',
      closed: Boolean(v.status?.archived || v.closedForApplicants),
    },
  },
];
