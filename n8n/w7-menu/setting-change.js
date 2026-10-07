// W7 · Setting change — изменение настройки из ⚙️ (07.10.2026). Ветка выше «Rows»: выполняется до «Render»,
// и панель покажет новое значение.
// Нода: Code, режим «Run Once for All Items». Вход: «Job», «Settings» — строки таблицы settings.
//   change = { name } — кнопка «▸»: следующее значение по кругу;
//   change = { name: 'filter.rules_off', toggle } — правило фильтра: выключить или включить;
//   input = { name, text } — ответ на вопрос со списком: новый список целиком (ошибку покажет «Render»).
// Выход: [{ name, value_json, value, previous }] → «Save setting» (upsert по name) или [] — менять нечего.

// @include n8n/shared/settings.js

const job = $('Job').first().json;
const s = loadSettings($('Settings').all());
const result = (name, value) => [{ json: { name, value_json: JSON.stringify(value), value, previous: s[name] } }];

if (job.input && SETTINGS[job.input.name]?.words) {
  const parsed = parseWords(job.input.text);
  return parsed.error ? [] : result(job.input.name, parsed.words);
}

const name = job.change?.name;
if (!name || !SETTINGS[name]) return [];
if (job.change.toggle) {
  return FILTER_RULES[job.change.toggle] ? result(name, toggleListItem(s[name], job.change.toggle)) : [];
}
return SETTINGS[name].options ? result(name, nextSetting(name, s[name])) : [];
