// W1 · Filter search — быстрые правила по данным выдачи, до захода на страницу вакансии.
// Нода: Code, режим «Run Once for All Items».
// Вход: новые вакансии из «Is new» и строки чёрного списка из «Blacklist».
// Выход: те же вакансии со status = new | rejected и причиной в reasons.
// Правила — решения пользователя от 07.10.2026 (CLAUDE.md §7). Из настроек бота (⚙️ → 🧹 Фильтр): какие правила
// выключены (filter.rules_off), порог откликов (filter.max_responses, 0 — не отсекать) и стоп-слова (filter.stop_words).

// @include n8n/shared/ai.js

// @include n8n/shared/settings.js

const settings = loadSettings($('Settings').all());
// Правила фронтенда (Angular, чужой стек, бэкенд) — только у пресета frontend (13.10.2026)
const rules = filterRulesFor(settings['profile.preset']);
const off = new Set(settings['filter.rules_off']);
const maxResponses = settings['filter.max_responses'];
const stopWords = wordsRegex(settings['filter.stop_words']);
const rows = $('Is new').all().map((i) => i.json);

// Чёрный список: в колонке company — точное название компании, как на hh (без учёта регистра
// и пробелов по краям), или её id на hh (только цифры).
// Форму организации не сравниваем: на странице вакансии hh пишет «ООО ОнТаргет ЛАБС», в выдаче — «ОнТаргет ЛАБС»
const ORG_FORM = /^(ооо|оао|зао|пао|ао|нао|ип|тоо|нко|ано|гуп|муп|фгуп|гку|гбу|llc|ltd|inc)\.?\s+|\s+(ооо|оао|зао|пао|ао|нао|ип|тоо|llc|ltd|inc)\.?$/g;
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(ORG_FORM, '');
const blacklist = new Set(
  $('Blacklist')
    .all()
    .map((i) => norm(i.json.company))
    .filter(Boolean),
);

const inBlacklist = (r) => blacklist.has(norm(r.company)) || blacklist.has(String(r.company_id));

// \b и \w в JS не работают с кириллицей — границы слова и окончания задаём явно
const ru = (word) => new RegExp(`(^|[^а-яё])${word}([^а-яё]|$)`, 'i');

// [id (n8n/shared/settings.js → FILTER_RULES), причина в reasons, проверка]
const RULES = [
  ['no_exp', 'без опыта', (r) => r.experience === 'noExperience'],
  [
    'junior',
    'junior/стажёр',
    (r) => /junior|\bintern|trainee/i.test(r.title) || ru('(стаж[её]р|младш[а-яё]*|джун[а-яё]*)').test(r.title),
  ],
  // Vue не отсекаем (решение пользователя 07.10.2026): только Vue — нейросеть ставит maybe, React + Vue — как React
  ['angular', 'Angular', (r) => /angular/i.test(r.title)],
  [
    'lead',
    'Lead/архитектор',
    (r) =>
      (/\b(team ?lead|tech ?lead|lead|head|architect|cto)\b/i.test(r.title) ||
        ru('(тимлид[а-яё]*|техлид[а-яё]*|лид|архитектор[а-яё]*|руководител[а-яё]*)').test(r.title)) &&
      !/senior|middle/i.test(r.title) &&
      !ru('(старш[а-яё]*|ведущ[а-яё]*)').test(r.title),
  ],
  // Стоп-слова — список из настроек: PHP (и Laravel, Symfony, Yii — 07.10.2026: «Laravel + Nuxt» пользователь
  // отклонил), 1С, WordPress, Битрикс, QA/тестировщик, преподаватель/наставник
  ['stop', 'стоп-слово', (r) => stopWords.test(r.title)],
  // Поиск frontend по всему тексту приносит чужой бэкенд (07.10.2026): режем по названию, в том числе fullstack
  // с таким бэкендом (пользователь отклонил «.Net/React») и AI на таком стеке (AI берём только на JS/TS).
  // Python — только без JS/TS и фронтенда в названии: «Python + React» пользователь берёт, AI на Python — нет
  [
    'foreign',
    'чужой стек',
    (r) =>
      /\bruby\b|\brails\b|c#|\.net\b|\bdotnet\b|\bjava\b(?!\s*script)|\bgo(lang)?\b|\bdwh\b|data[\s-]*engineer/i.test(r.title) ||
      ru('(дата[\\s-]*инженер[а-яё]*)').test(r.title) ||
      (/\b(python|django|fastapi|flask)\b/i.test(r.title) &&
        !/react|vue|nuxt|next\.?js|node|nest\.?js|typescript|javascript|\bjs\b|\bts\b|front[\s-]?end|full[\s-]?stack/i.test(r.title) &&
        !ru('(фул+[\\s-]?ст[еэ]к[а-яё]*|фронт[\\s-]?[еэ]нд[а-яё]*)').test(r.title)),
  ],
  [
    'backend',
    'бэкенд',
    (r) =>
      !isAi(r.title) &&
      (/back[\s-]?end/i.test(r.title) || ru('(б[эе]к[\\s-]?[эе]нд[а-яё]*)').test(r.title)) &&
      !/full[\s-]?stack|front[\s-]?end/i.test(r.title) &&
      !ru('(фул+[\\s-]?ст[еэ]к[а-яё]*|фронт[\\s-]?[еэ]нд[а-яё]*)').test(r.title),
  ],
  ['responses', `> ${maxResponses} откликов`, (r) => maxResponses > 0 && (r.responses ?? 0) > maxResponses],
  ['blacklist', 'чёрный список', inBlacklist],
].filter(([id]) => id === 'responses' || (id in rules && !off.has(id)));

return rows.map((r) => {
  const failed = RULES.filter(([, , test]) => test(r)).map(([, name]) => name);
  return { json: { ...r, status: failed.length ? 'rejected' : 'new', reasons: failed.join(', ') } };
});
