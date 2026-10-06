// W3 · Apply sent — кнопки под письмом «📨 Отправил» и «↩️ Отменить».
// Нода: Code, режим «Run Once for All Items».
// Вход: строка вакансии из «Sent row», кнопка — из «Route» (op = sent | unsent; messageId — сообщение с письмом).
// Выход: { id, sent, status, applied_at, letterText, cardText, chatId, letterMessageId, cardId, queryId, toast, apply_url, url }
//   sent   — status = applied; у письма остаётся только «↩️ Отменить», у карточки кнопки убираются;
//   unsent — status = approved; письму возвращаются все кнопки, карточке — «↩️ Изменить».

// @include n8n/shared/card.js
// @include n8n/shared/letter.js

const action = $('Route').first().json;
const row = $input.first().json;
const sent = action.op === 'sent';
const updated = {
  ...row,
  status: sent ? 'applied' : 'approved',
  applied_at: sent ? row.applied_at || new Date().toISOString() : '',
};

return [
  {
    json: {
      id: row.id,
      sent,
      status: updated.status,
      applied_at: updated.applied_at,
      letterText: letterText({ ...updated, ok: Boolean(row.letter), problem: 'письма нет', mode: 'new' }),
      cardText: cardText(updated),
      chatId: action.chatId,
      letterMessageId: action.messageId,
      cardId: row.tg_message_id,
      queryId: action.queryId,
      toast: sent ? '📨 Записал: отклик отправлен' : '↩️ Отменил: отклик не отправлен',
      apply_url: row.apply_url,
      url: row.url,
    },
  },
];
