// W7 · Setting change — изменение настройки из ⚙️ (07.10.2026). Ветка выше «Rows»: выполняется до «Render»,
// и панель покажет новое значение.
// Нода: Code, режим «Run Once for All Items». Вход: «Job», «Settings» — строки таблицы settings.
//   change = { name } — кнопка «▸»: следующее значение по кругу;
//   change = { name: 'filter.rules_off', toggle } — правило фильтра: выключить или включить;
//   change = { name } у настройки-метки (stamp: llm.shadow_since — «🔄 Теневой заново») — записать «сейчас»;
//   input = { name, text } — ответ на вопрос со списком: новый список слов или спорных случаев целиком
//   (ошибку покажет «Render»);
//   change = { name: 'apply.auto', set } — ▶️ Запустить / ⏹ Остановить автоотклик (6.1c): значение явное, двойное
//   нажатие не переключит обратно; запуск заодно включает робота, снимает паузу и ставит apply.auto_since.
// Выход: [{ name, value_json, value, previous }] → «Save setting» (upsert по name) или [] — менять нечего.

// @include n8n/shared/settings.js

const job = $('Job').first().json;
const s = loadSettings($('Settings').all());
const result = (name, value) => [{ json: { name, value_json: JSON.stringify(value), value, previous: s[name] } }];

if (job.input && SETTINGS[job.input.name]?.words) {
  // «-» — очистить список, если он может быть пустым (слова «везде в тексте», стоп-слова)
  if (/^[-—]$/.test(String(job.input.text).trim()) && SETTINGS[job.input.name].min === 0) return result(job.input.name, []);
  const parsed = parseWords(job.input.text);
  return parsed.error ? [] : result(job.input.name, parsed.words);
}
if (job.input && SETTINGS[job.input.name]?.cases) {
  const parsed = parseCases(job.input.text);
  return parsed.error ? [] : result(job.input.name, parsed.cases);
}

const name = job.change?.name;
if (!name || !SETTINGS[name]) return [];
if (name === 'apply.auto' && typeof job.change.set === 'boolean') {
  const on = job.change.set;
  if (s['apply.auto'] === on) return [];
  return on
    ? [
        ...result('apply.auto', true),
        ...result('apply.auto_since', new Date().toISOString()),
        ...(s['apply.enabled'] ? [] : result('apply.enabled', true)),
        ...(s['apply.paused'] ? result('apply.paused', false) : []),
      ]
    : result('apply.auto', false);
}
if (SETTINGS[name].stamp) return result(name, new Date().toISOString());
if (job.change.toggle) {
  return FILTER_RULES[job.change.toggle] ? result(name, toggleListItem(s[name], job.change.toggle)) : [];
}
return SETTINGS[name].options ? result(name, nextSetting(name, s[name])) : [];
