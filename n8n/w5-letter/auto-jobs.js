// W5 · Auto jobs — автоотклик (6.1c): записанные письма, которые уходят в очередь робота → задания W9 enqueue.
// Нода: Code, режим «Run Once for All Items». Вход: строки, которые обновила «Save letter»; что решили — «Format letter»
// (auto). W9 «Plan» ещё раз проверит, можно ли (автоотклик включён, вакансия ✅, не в очереди).
const auto = new Set(
  $('Format letter')
    .all()
    .filter((i) => i.json.auto)
    .map((i) => i.json.id),
);
return $input
  .all()
  .filter((i) => auto.has(i.json.id))
  .map((i) => ({ json: { op: 'enqueue', auto: true, id: i.json.id } }));
