// W6 · Unstick — строки, застрявшие в scoring дольше 30 мин, вернуть в detailed (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Своя ветка ниже сводки.
// W2 «Claim» переводит строки detailed → scoring на время оценки, «Release» возвращает неотправленные.
// Если W2 упал посреди оценки, «Release» не выполнился — строку вернёт эта ветка, оценит следующий запуск W2.
// Вход: «All rows». Выход: [{ id }] → «Save unstuck».

const now = Date.now();
return $('All rows')
  .all()
  .map((i) => i.json)
  .filter((r) => r.id && r.status === 'scoring' && now - (Date.parse(r.updatedAt) || now) > 30 * 60 * 1000)
  .map((r) => ({ json: { id: r.id } }));
