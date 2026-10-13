// Настройки из бота (⚙️ Настройки, решения пользователя 07.10.2026): схема, значения по умолчанию, чтение.
// В таблице settings (name, value_json) лежат только изменения пользователя: пустая таблица — значения по умолчанию,
// то есть поведение до появления настроек. Значение, которое не проходит проверку схемы, заменяется значением
// по умолчанию — битая строка в таблице не ломает сбор.
// Общий код W1, W2, W5, W6, W7, W8, W9: строка «// @include n8n/shared/settings.js» (перед n8n/shared/schedule.js).

// Правила фильтра W1, которые можно выключить (filter.rules_off): id → подпись. «В архиве» не выключается
const FILTER_RULES = {
  no_exp: 'без опыта',
  junior: 'junior/стажёр',
  angular: 'Angular',
  lead: 'Lead/архитектор',
  stop: 'стоп-слова',
  foreign: 'чужой стек',
  backend: 'бэкенд',
  blacklist: 'чёрный список',
  only_rf: 'только из РФ',
  no_stack: 'нет React и Vue',
};
// Правила фронтенда (пресет frontend, 13.10.2026): у остальных профессий они отсекли бы всё — не работают
// и не показываются в ⚙️
const FRONTEND_FILTER_RULES = ['angular', 'foreign', 'backend', 'no_stack'];
// Правила фильтра для пресета: id → подпись
const filterRulesFor = (preset) =>
  Object.fromEntries(Object.entries(FILTER_RULES).filter(([id]) => preset === 'frontend' || !FRONTEND_FILTER_RULES.includes(id)));

const SETTINGS = {
  // Сбор (W8 Clock): интервал днём и ночью (мин, 0 — ночью не собирать), «день» по Москве, пауза
  'collect.day_every': { default: 30, options: [15, 30, 60] },
  'collect.night_every': { default: 120, options: [60, 120, 240, 0] },
  'collect.day_window': { default: '07-18', options: ['07-18', '08-20', '06-22', '09-18'] },
  'collect.paused': { default: false, options: [false, true] },
  // Поиск на hh (W1, n8n/shared/search.js): период в днях; слова везде в тексте и только в названии.
  // Слов «везде» может не быть (ищем только по названию) — «-» в ответе на ✏️ очищает список
  'search.period': { default: 1, options: [1, 3, 7] },
  'search.anywhere': { default: ['frontend'], words: true, min: 0 },
  'search.in_name': {
    default: ['react', 'next.js', 'nextjs', 'vue', 'vue.js', 'vuejs', 'nuxt', 'nuxt.js', 'nuxtjs', 'typescript',
      'AI', 'ИИ', 'LLM', 'GenAI', 'GPT', 'нейросети', 'нейросетей'],
    words: true,
  },
  // Роли hh (professional_role, n8n/shared/hh-roles.js), формат работы, город для офиса и гибрида, образование —
  // онбординг пишет их по резюме (13.10.2026, docs/onboarding.md). Удалёнка ищется по всем регионам, офис и гибрид —
  // в городе search.area: два запроса hh
  'search.roles': { default: ['96'], roles: true },
  'search.formats': { default: ['REMOTE'], formats: true },
  'search.area': { default: null, area: true },
  'search.education': { default: ['not_required_or_not_specified'], education: true },
  // Фильтр W1: порог откликов (0 — не отсекать), выключенные правила, стоп-слова в названии («*» — любое окончание)
  'filter.max_responses': { default: 3000, options: [1000, 2000, 3000, 5000, 0] },
  'filter.rules_off': { default: [], list: Object.keys(FILTER_RULES) },
  'filter.stop_words': {
    min: 0,
    default: ['php*', 'laravel', 'symfony', 'yii', 'wordpress', 'bitrix*', 'битрикс*', 'qa', '1c', '1с', 'teacher',
      'tutor', 'instructor', "o'qituvchi", 'oqituvchi', 'преподавател*', 'тестировщик*', 'наставник*'],
    words: true,
  },
  // Нейросеть (W2, W5): провайдер; теневой режим — карточки и на skip (выкл — skip только в сводке)
  'llm.provider': { default: 'gemini', options: ['gemini', 'claude'] },
  'llm.shadow': { default: true, options: [true, false] },
  // Спорные случаи — список «случай: решение» (✏️, решение пользователя 07.10.2026: текстом, а не кнопками).
  // По умолчанию — четыре встроенных случая промпта W2 с их решениями; отличие от них уходит в промпт
  // «Поправками кандидата» (n8n/w2-score/build-prompt.js)
  'llm.cases': {
    default: [
      { case: 'Vue без React', decision: 'maybe' },
      { case: 'fullstack', decision: 'maybe' },
      { case: 'AI на JS/TS', decision: 'apply' },
      { case: 'React Native', decision: 'skip' },
    ],
    cases: true,
  },
  // Робот-отклик (этап 6, docs/stages/stage-6.md): кнопка 🚀 под новыми письмами, пауза очереди,
  // лимит живых откликов в «день» робота (с 09:00 по местному). Предохранитель APPLY_LIVE — в .env, не здесь
  'apply.enabled': { default: false, options: [false, true] },
  'apply.paused': { default: false, options: [false, true] },
  'apply.daily_limit': { default: 25, options: [10, 15, 25, 40] },
  // Профиль (13.10.2026, docs/onboarding.md): резюме и факты о человеке. Пишет онбординг W11 (резюме PDF в боте)
  // или импорт (node scripts/n8n-api.mjs profile-import). Умолчания — поведение до онбординга: онбординг
  // записывает все свои строки явно. Пресет frontend — откалиброванные правила владельца в коде (W2, W5)
  'profile.ready': { default: false, options: [false, true] },
  'profile.preset': { default: 'generic', options: ['generic', 'frontend'] },
  'profile.resume': { default: '', text: 30000 },
  'profile.extra': { default: '', text: 4000 },
  // Факты из резюме (имя и его родительный падеж, должность, компании, пол — только если указан в резюме…)
  'profile.facts': { default: {}, object: true },
  // Строки «О кандидате» промпта W2
  'profile.about': { default: [], lines: 400 },
  // Часовой пояс человека (IANA): время в боте, тихие часы, «день» робота, сводка в 10:00 (n8n/shared/time.js).
  // Пусто — пояс компьютера (USER_TZ из .env), иначе Москва
  'profile.tz': { default: '', tz: true },
  'profile.signature': { default: '', text: 60 },
  'profile.contact': { default: '', text: 160 },
  // Правила оценки пресета generic — из резюме (W11): { skip, maybe, apply, ignore, notes } — списки строк
  'llm.rules': { default: {}, rules: true },
  // Письма (W5): свои образцы и замена разделов промпта { intro, facts, style } (у владельца — из импорта)
  'letters.examples': { default: '', text: 4000 },
  'letters.prompt': { default: {}, object: true },
};

// Встроенные спорные случаи промпта W2: как узнать их в списке пользователя, решение по умолчанию
// и формулировка для поправки
const BUILTIN_CASES = {
  vue: {
    aliases: ['vue без react', 'vue', 'nuxt', 'vue/nuxt', 'vue nuxt'],
    default: 'maybe',
    prompt: 'основной стек — Vue (Vue.js, Nuxt), а React нет в обязательных требованиях',
  },
  fullstack: {
    aliases: ['fullstack', 'full stack', 'full-stack', 'фулстек', 'фуллстек', 'fullstack с react'],
    default: 'maybe',
    prompt: 'fullstack: в обязательных требованиях и React, и бэкенд на любом языке',
  },
  ai_js: {
    aliases: ['ai на js/ts', 'ai на js', 'ai на ts', 'ai js/ts', 'ai js', 'ai', 'разработка на ai'],
    default: 'apply',
    prompt: 'разработка на AI на JS/TS (Node.js, NestJS, TypeScript): интеграции LLM, AI-агенты, RAG',
  },
  react_native: {
    aliases: ['react native', 'react-native', 'rn'],
    default: 'skip',
    prompt: 'мобильная разработка на React Native — основная работа',
  },
};
const normCase = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
// Встроенный случай, которому соответствует запись пользователя, или null
const builtinOf = (text) =>
  Object.keys(BUILTIN_CASES).find((key) => BUILTIN_CASES[key].aliases.includes(normCase(text))) ?? null;

// Слово списка: буквы, цифры, пробел и . + # ' - ; «*» в конце — любое окончание. Без скобок и кавычек:
// они сломали бы язык запросов hh
const WORD_RE = /^[\p{L}\p{N}][\p{L}\p{N} .+#'’-]{0,28}\*?$/u;

// items — $('Settings').all() (строки таблицы settings) → { имя: значение }
function loadSettings(items) {
  const stored = {};
  for (const item of items ?? []) {
    const row = item?.json ?? item;
    if (!row?.name || !(row.name in SETTINGS)) continue;
    try {
      stored[row.name] = JSON.parse(row.value_json);
    } catch {
      // битое значение — останется по умолчанию
    }
  }
  const out = {};
  for (const [name, spec] of Object.entries(SETTINGS)) {
    const value = stored[name];
    out[name] = value !== undefined && validSetting(spec, value) ? value : spec.default;
  }
  return out;
}

function validSetting(spec, value) {
  if (spec.options) return spec.options.some((o) => o === value);
  if (spec.words) {
    return Array.isArray(value) && value.length >= (spec.min ?? 1) && value.length <= 40 && value.every((w) => WORD_RE.test(w));
  }
  if (spec.roles) return Array.isArray(value) && value.length <= 10 && value.every((id) => /^\d{1,4}$/.test(String(id)));
  if (spec.formats) return Array.isArray(value) && value.length > 0 && value.every((f) => WORK_FORMATS.includes(f));
  if (spec.area) {
    return value === null || (Boolean(value) && /^\d{1,7}$/.test(String(value.id)) && typeof value.name === 'string' && value.name.length <= 80);
  }
  if (spec.education) return Array.isArray(value) && value.every((e) => EDUCATION.includes(e));
  if (spec.list) return Array.isArray(value) && value.every((v) => spec.list.includes(v));
  if (spec.cases) {
    return (
      Array.isArray(value) &&
      value.length <= 20 &&
      value.every((c) => CASE_RE.test(c?.case ?? '') && ['apply', 'maybe', 'skip'].includes(c?.decision))
    );
  }
  if (spec.text) return typeof value === 'string' && value.length <= spec.text;
  if (spec.tz) {
    try {
      return typeof value === 'string' && Boolean(value) && Boolean(new Intl.DateTimeFormat('en-GB', { timeZone: value }));
    } catch {
      return false;
    }
  }
  if (spec.lines) return validLines(value, spec.lines);
  if (spec.object) return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (spec.rules) {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(([key, lines]) => RULE_KEYS.includes(key) && validLines(lines, 400))
    );
  }
  return false;
}

// Форматы работы и уровни образования — значения параметров поиска hh
const WORK_FORMATS = ['REMOTE', 'HYBRID', 'ON_SITE', 'FIELD_WORK'];
const EDUCATION = ['not_required_or_not_specified', 'special_secondary', 'higher'];

// Разделы правил оценки (llm.rules) и список строк: до 20 строк, каждая — до max знаков
const RULE_KEYS = ['skip', 'maybe', 'apply', 'ignore', 'notes'];
const validLines = (lines, max) =>
  Array.isArray(lines) && lines.length <= 20 && lines.every((l) => typeof l === 'string' && l.length <= max);

// Текст резюме для промптов W2 и W5: резюме и «Дополнительно» (то, что человек дописал сам) — своим разделом
function resumeText(s) {
  const resume = String(s['profile.resume'] ?? '').trim();
  const extra = String(s['profile.extra'] ?? '').trim();
  return extra ? `${resume}\n\n## Дополнительно\n${extra}` : resume;
}

// Спорный случай: 2–80 знаков, без угловых скобок и обратных кавычек
const CASE_RE = /^[^<>`]{2,80}$/u;
const DECISION_WORDS = {
  apply: 'apply',
  '🟢': 'apply',
  откликнусь: 'apply',
  maybe: 'maybe',
  '🟡': 'maybe',
  возможно: 'maybe',
  skip: 'skip',
  '🔴': 'skip',
  мимо: 'skip',
};

// Список спорных случаев из ответа пользователя: «Vue без React: maybe, Angular: skip» → [{ case, decision }].
// Случаи — через запятую; если в описании нужна запятая — через «;» или с новой строки. Между случаем и решением —
// «:», «=» или тире; решение — apply, maybe, skip (или 🟢 🟡 🔴, откликнусь, возможно, мимо).
// «-» — очистить список. { error } — что не так
function parseCases(text) {
  const raw = String(text ?? '').trim();
  if (raw === '-' || raw === '—') return { cases: [] };
  const parts = (/[;\n]/.test(raw) ? raw.split(/[;\n]+/) : raw.split(',')).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return { error: 'список пуст (очистить — пришли «-»)' };
  if (parts.length > 20) return { error: `случаев ${parts.length}, можно до 20` };
  const cases = [];
  for (const part of parts) {
    const m = part.match(/^(.+?)\s*[:=—–]\s*(\S+)$/u) ?? part.match(/^(.+?)\s+-\s+(\S+)$/u);
    const decision = m && DECISION_WORDS[m[2].toLowerCase()];
    if (!decision) return { error: `«${part}»: нужно «случай: решение», решение — apply, maybe или skip` };
    const name = m[1].trim();
    if (!CASE_RE.test(name)) return { error: `«${name}»: описание случая — от 2 до 80 знаков, без < > и \`` };
    const existing = cases.find((c) => normCase(c.case) === normCase(name));
    if (existing) existing.decision = decision;
    else cases.push({ case: name, decision });
  }
  return { cases };
}

// Список для показа и вопроса: «Vue без React: maybe, fullstack: maybe»
const casesText = (cases) => cases.map((c) => `${c.case}: ${c.decision}`).join(', ');

// Список слов из ответа пользователя: «frontend, react, AI» → ['frontend', 'react', 'AI'];
// { error } — если список пуст, длиннее 40 слов или в слове недопустимые символы
function parseWords(text) {
  const seen = new Map();
  for (const w of String(text ?? '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    if (!seen.has(w.toLowerCase())) seen.set(w.toLowerCase(), w);
  }
  const words = [...seen.values()];
  if (!words.length) return { error: 'список пуст' };
  if (words.length > 40) return { error: `слов ${words.length}, можно до 40` };
  const bad = words.find((w) => !WORD_RE.test(w));
  if (bad) return { error: `«${bad}»: только буквы, цифры, пробел и . + # ' -, «*» в конце, до 30 знаков` };
  return { words };
}

// Включить или выключить элемент списка (filter.rules_off)
const toggleListItem = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

// Слово списка → регулярка с границами слова (латиница, кириллица, цифры); «*» в конце — любое окончание
function wordsRegex(words) {
  const parts = words.map((w) => {
    const stem = w.replace(/\*$/, '').replace(/[.+#'’-]/g, (c) => `\\${c}`);
    return w.endsWith('*') ? `${stem}[a-zа-яё0-9]*` : stem;
  });
  return new RegExp(`(^|[^a-zа-яё0-9])(${parts.join('|')})([^a-zа-яё0-9]|$)`, 'i');
}

// Следующее значение по кругу — кнопка «▸» (только у настроек с вариантами)
function nextSetting(name, current) {
  const { options } = SETTINGS[name];
  return options[(options.findIndex((o) => o === current) + 1) % options.length];
}

// Расписание сбора для n8n/shared/schedule.js
function scheduleFrom(s) {
  const [dayFrom, dayTo] = String(s['collect.day_window']).split('-').map(Number);
  return {
    dayFrom,
    dayTo,
    dayEvery: s['collect.day_every'],
    nightEvery: s['collect.night_every'],
    paused: s['collect.paused'],
  };
}
