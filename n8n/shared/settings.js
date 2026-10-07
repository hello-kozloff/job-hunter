// Настройки из бота (⚙️ Настройки, решения пользователя 07.10.2026): схема, значения по умолчанию, чтение.
// В таблице settings (name, value_json) лежат только изменения пользователя: пустая таблица — значения по умолчанию,
// то есть поведение до появления настроек. Значение, которое не проходит проверку схемы, заменяется значением
// по умолчанию — битая строка в таблице не ломает сбор.
// Общий код W1, W6, W7, W8: строка «// @include n8n/shared/settings.js» (перед n8n/shared/schedule.js).

const SETTINGS = {
  // Сбор (W8 Clock): интервал днём и ночью (мин, 0 — ночью не собирать), «день» по Москве, пауза
  'collect.day_every': { default: 30, options: [15, 30, 60] },
  'collect.night_every': { default: 120, options: [60, 120, 240, 0] },
  'collect.day_window': { default: '07-18', options: ['07-18', '08-20', '06-22', '09-18'] },
  'collect.paused': { default: false, options: [false, true] },
};

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
    out[name] = value !== undefined && spec.options.some((o) => o === value) ? value : spec.default;
  }
  return out;
}

// Следующее значение по кругу — кнопка «▸»
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
