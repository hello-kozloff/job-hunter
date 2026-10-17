// W3 · Apply sent — кнопки под письмом «📨 Отправил» и «↩️ Отменить».
// Нода: Code, режим «Run Once for All Items».
// Вход: строка вакансии из «Sent row», кнопка — из «Route» (op = sent | unsent; messageId — сообщение с письмом).
// Выход: { id, sent, busy, status, applied_at, apply_by, robot, robot_button, letterText, cardText, chatId, letterMessageId,
//          cardId, queryId, toast, apply_url, url }
//   sent   — status = applied; у письма остаётся только «↩️ Отменить», у карточки кнопки убираются;
//   unsent — status = approved; письму возвращаются все кнопки (с 🚀, если подходит роботу), карточке — «↩️ Изменить».
//   busy — вакансия в очереди робота (этап 6): ничего не меняем, только тост. «📨 Отправил» пишет apply_by = me.

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/robot.js
// @include n8n/shared/letter.js

const action = $('Route').first().json;
// Строка — из «Sent row» по имени: вход этой ноды может смениться при правках workflow
const row = $('Sent row').first().json;
// Робот (этап 6) отправляет отклик с этим письмом — кнопки письма не трогаем
const busy = Boolean(row.apply_state);
const sent = !busy && action.op === 'sent';
const updated = busy
  ? row
  : {
      ...row,
      status: sent ? 'applied' : 'approved',
      applied_at: sent ? row.applied_at || new Date().toISOString() : '',
      apply_by: sent ? 'me' : '',
    };

return [
  {
    json: {
      id: row.id,
      sent,
      busy,
      status: updated.status,
      applied_at: updated.applied_at ?? '',
      apply_by: updated.apply_by ?? '',
      // «↩️ Отменить»: письму возвращаются кнопки — с 🚀, если вакансия подходит роботу
      robot: robotEligible({ ...updated, apply_state: '' }),
      robot_button: robotButtonText(updated),
      letterText: letterText({ ...updated, ok: Boolean(row.letter), problem: 'письма нет', mode: 'new' }),
      cardText: cardText(updated),
      chatId: action.chatId,
      letterMessageId: action.messageId,
      cardId: row.tg_message_id,
      queryId: action.queryId,
      toast: busy
        ? '🚀 Робот в работе — сначала ⛔ под письмом'
        : sent
          ? '📨 Записал: отклик отправлен'
          : '↩️ Отменил: отклик не отправлен',
      apply_url: row.apply_url,
      url: row.url,
    },
  },
];
