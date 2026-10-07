// W2 · Run stats — сколько карточек отправил этот запуск → журнал сборов runs (запись W1 «Start run»).
// Нода: Code, режим «Run Once for All Items». Своя ветка от триггера, ниже «Summary»: выполняется последней.
// Вход: $input — item триггера: от W1 { runId, … }, у ручного запуска runId нет;
//       «Send card» — ответы Telegram (выполняется, только если были вакансии на оценку).
// Выход: [{ id, cards }] → «Save run stats» или [] — ручной запуск W2, сбора не было.

const runId = $input.first()?.json?.runId;
if (!runId) return [];

let cards = 0;
try {
  cards = $('Send card')
    .all()
    .filter((i) => i.json.result?.message_id).length;
} catch {
  // карточек в этом запуске не было — нода не выполнялась
}
return [{ json: { id: runId, cards } }];
