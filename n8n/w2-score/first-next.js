// W2 · First next — первый поиск: оценить следующую пачку сразу (вызвать W2 ещё раз) или закончить — снять
// profile.first_quiet (14.10.2026). Нода: Code, режим «Run Once for All Items». Самая нижняя ветка от триггера.
// Вход: «Summary» (флаги again / done). Выход: [{ again, done }] → «First again?» и «First done?» или [].

const flags = $('Summary')
  .all()
  .map((i) => i.json)
  .find((m) => m.again || m.done);
return flags ? [{ json: { again: Boolean(flags.again), done: Boolean(flags.done) } }] : [];
