// W13 · Save rows — строки settings для upsert по name: резюме, «Дополнительно», версии для отката (15.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Step» { save: { имя: значение } }, «Settings», static data (target).
// Основное резюме — ключи как есть; r2–r5 (docs/resumes.md) — текст и «Дополнительно» в resume.<id>, разметка и версии
// в resume.<id>.cv и resume.<id>.history (n8n/shared/resumes.js → resumeSaveRows).
// Выход: item на строку { name, value_json } → «Save resume».

// @include n8n/shared/settings.js

// @include n8n/shared/resumes.js

const all = loadSettings($('Settings').all());
const scope = resumeScope(all, $getWorkflowStaticData('global').target);
const save = resumeSaveRows(all, scope.id, $('Step').first().json.save ?? {});
return Object.entries(save).map(([name, value]) => ({ json: { name, value_json: JSON.stringify(value) } }));
