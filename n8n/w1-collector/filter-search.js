// W1 · Filter search — быстрые правила по данным выдачи, до захода на страницу вакансии.
// Нода: Code, режим «Run Once for All Items».
// Вход: новые вакансии из «Is new» и строки чёрного списка из «Blacklist».
// Выход: те же вакансии со status = new | rejected | seen и причиной в reasons.
// Правила — решения пользователя от 07.10.2026 (CLAUDE.md §7).

const firstRun = Boolean($('Plan').first().json.firstRun);
const rows = $('Is new').all().map((i) => i.json);

// Чёрный список: в колонке company — точное название компании, как на hh (без учёта регистра
// и пробелов по краям), или её id на hh (только цифры)
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const blacklist = new Set(
  $('Blacklist')
    .all()
    .map((i) => norm(i.json.company))
    .filter(Boolean),
);

const inBlacklist = (r) => blacklist.has(norm(r.company)) || blacklist.has(String(r.company_id));

// \b и \w в JS не работают с кириллицей — границы слова и окончания задаём явно
const ru = (word) => new RegExp(`(^|[^а-яё])${word}([^а-яё]|$)`, 'i');

const RULES = [
  ['без опыта', (r) => r.experience === 'noExperience'],
  ['junior/стажёр', (r) => /junior|\bintern|trainee/i.test(r.title) || ru('(стаж[её]р|младш[а-яё]*|джун[а-яё]*)').test(r.title)],
  ['Vue/Angular', (r) => /vue|angular/i.test(r.title)],
  [
    'Lead/архитектор',
    (r) =>
      (/\b(team ?lead|tech ?lead|lead|head|architect|cto)\b/i.test(r.title) ||
        ru('(тимлид[а-яё]*|техлид[а-яё]*|лид|архитектор[а-яё]*|руководител[а-яё]*)').test(r.title)) &&
      !/senior|middle/i.test(r.title) &&
      !ru('(старш[а-яё]*|ведущ[а-яё]*)').test(r.title),
  ],
  [
    'стоп-слово',
    (r) =>
      /php|wordpress|bitrix|\bqa\b|\b1c\b|teacher|tutor|instructor|o.?qituvchi/i.test(r.title) ||
      ru('(1с|битрикс[а-яё]*|преподавател[а-яё]*|тестировщик[а-яё]*|наставник[а-яё]*)').test(r.title),
  ],
  ['> 3000 откликов', (r) => (r.responses ?? 0) > 3000],
  ['чёрный список', inBlacklist],
];

return rows.map((r) => {
  if (firstRun) return { json: { ...r, status: 'seen', reasons: '' } };
  const failed = RULES.filter(([, test]) => test(r)).map(([name]) => name);
  return { json: { ...r, status: failed.length ? 'rejected' : 'new', reasons: failed.join(', ') } };
});
