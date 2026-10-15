// W13 · Save rows — строки settings для upsert по name: резюме, «Дополнительно», версии для отката (15.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Step» { save: { имя: значение } }.
// Выход: item на строку { name, value_json } → «Save resume».

const save = $('Step').first().json.save ?? {};
return Object.entries(save).map(([name, value]) => ({ json: { name, value_json: JSON.stringify(value) } }));
