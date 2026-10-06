// W3 · Apply sent — «📨 Отправил» под письмом: отклик отправлен.
// Нода: Code, режим «Run Once for All Items».
// Вход: строка вакансии из «Sent row», кнопка — из «Route».
// Выход: { id, status: applied, applied_at, text, chatId, cardId, queryId } → «Save sent», «Answer sent», «Card: sent».

// @include n8n/shared/card.js

const action = $('Route').first().json;
const row = $input.first().json;
const appliedAt = row.applied_at || new Date().toISOString();
const updated = { ...row, status: 'applied', applied_at: appliedAt };

return [
  {
    json: {
      id: row.id,
      status: 'applied',
      applied_at: appliedAt,
      text: cardText(updated),
      chatId: action.chatId,
      cardId: row.tg_message_id,
      queryId: action.queryId,
    },
  },
];
