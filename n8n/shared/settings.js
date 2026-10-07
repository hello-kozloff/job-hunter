// Настройки из бота (⚙️ Настройки, решения пользователя 07.10.2026): схема, значения по умолчанию, чтение.
// В таблице settings (name, value_json) лежат только изменения пользователя: пустая таблица — значения по умолчанию,
// то есть поведение до появления настроек. Значение, которое не проходит проверку схемы, заменяется значением
// по умолчанию — битая строка в таблице не ломает сбор.
// Общий код W1, W6, W7, W8: строка «// @include n8n/shared/settings.js» (перед n8n/shared/schedule.js).

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

const SETTINGS = {
  // Сбор (W8 Clock): интервал днём и ночью (мин, 0 — ночью не собирать), «день» по Москве, пауза
  'collect.day_every': { default: 30, options: [15, 30, 60] },
  'collect.night_every': { default: 120, options: [60, 120, 240, 0] },
  'collect.day_window': { default: '07-18', options: ['07-18', '08-20', '06-22', '09-18'] },
  'collect.paused': { default: false, options: [false, true] },
  // Поиск на hh (W1, n8n/shared/search.js): период в днях; слова везде в тексте и только в названии
  'search.period': { default: 1, options: [1, 3, 7] },
  'search.anywhere': { default: ['frontend'], words: true },
  'search.in_name': {
    default: ['react', 'next.js', 'nextjs', 'vue', 'vue.js', 'vuejs', 'nuxt', 'nuxt.js', 'nuxtjs', 'typescript',
      'AI', 'ИИ', 'LLM', 'GenAI', 'GPT', 'нейросети', 'нейросетей'],
    words: true,
  },
  // Фильтр W1: порог откликов (0 — не отсекать), выключенные правила, стоп-слова в названии («*» — любое окончание)
  'filter.max_responses': { default: 3000, options: [1000, 2000, 3000, 5000, 0] },
  'filter.rules_off': { default: [], list: Object.keys(FILTER_RULES) },
  'filter.stop_words': {
    default: ['php*', 'laravel', 'symfony', 'yii', 'wordpress', 'bitrix*', 'битрикс*', 'qa', '1c', '1с', 'teacher',
      'tutor', 'instructor', "o'qituvchi", 'oqituvchi', 'преподавател*', 'тестировщик*', 'наставник*'],
    words: true,
  },
  // Нейросеть (W2, W5): провайдер; теневой режим — карточки и на skip (выкл — skip только в сводке);
  // решения по спорным правилам (n8n/w2-score/build-prompt.js: не по умолчанию — «Поправки кандидата»)
  'llm.provider': { default: 'gemini', options: ['gemini', 'claude'] },
  'llm.shadow': { default: true, options: [true, false] },
  'llm.vue': { default: 'maybe', options: ['apply', 'maybe', 'skip'] },
  'llm.fullstack': { default: 'maybe', options: ['apply', 'maybe', 'skip'] },
  'llm.ai_js': { default: 'apply', options: ['apply', 'maybe', 'skip'] },
  'llm.react_native': { default: 'skip', options: ['skip', 'maybe', 'apply'] },
};

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
  if (spec.words) return Array.isArray(value) && value.length > 0 && value.length <= 40 && value.every((w) => WORD_RE.test(w));
  if (spec.list) return Array.isArray(value) && value.every((v) => spec.list.includes(v));
  return false;
}

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
