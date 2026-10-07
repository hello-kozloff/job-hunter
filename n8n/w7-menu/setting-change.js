// W7 · Setting change — нажата кнопка настройки «▸»: следующее значение по кругу (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Ветка выше «Rows»: выполняется до «Render», и панель покажет новое значение.
// Вход: «Job» (change = { name }), «Settings» — строки таблицы settings.
// Выход: [{ name, value_json, value, previous }] → «Save setting» (upsert по name) или [] — менять нечего.

// @include n8n/shared/settings.js

const job = $('Job').first().json;
const name = job.change?.name;
if (!name || !(name in SETTINGS)) return [];

const previous = loadSettings($('Settings').all())[name];
const value = nextSetting(name, previous);
return [{ json: { name, value_json: JSON.stringify(value), value, previous } }];
