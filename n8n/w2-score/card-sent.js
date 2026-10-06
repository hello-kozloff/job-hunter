// W2 · Card sent — что записать в таблицу после отправки карточек.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы «Send card» ({ ok, result: { message_id } }; при ошибке, благодаря onError = continue, — { error }),
//       по порядку = items «Format card».
// Выход: обновления строк для «Save cards» — только колонки таблицы vacancies.
// Неотправленную карточку не записываем: строка остаётся detailed и уйдёт в следующий запуск,
// ошибку покажет «Summary».

const cards = $('Format card').all().map((i) => i.json);

return $input.all().flatMap((item, i) => {
  const messageId = item.json.result?.message_id;
  if (!messageId) return [];
  const card = cards[i];
  return [
    {
      json: {
        id: card.id,
        decision: card.decision,
        llm_reason: card.llm_reason,
        llm_model: card.llm_model,
        tg_message_id: messageId,
        status: 'waiting',
      },
    },
  ];
});
