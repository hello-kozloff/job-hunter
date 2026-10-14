// W3 · Apply cancel — «↩️ Отменить отклик» под письмом (решение пользователя 14.10.2026): вакансия снова ждёт решения.
// Нода: Code, режим «Run Once for All Items».
// Вход: строка вакансии из «Sent row», кнопка — из «Route» (op = cancel; messageId — сообщение с письмом).
// Выход: { id, ok, toast, queryId, chatId, cardId, cardText, letterMessageId, letterText, deleteIds }
//   ok — «Save cancel»: status = waiting, решение и причина сброшены, письмо забыто (✅ снова — новое письмо),
//        3 дня до «⌛ устарела» — заново. Карточке — кнопки выбора («Card: reset»); письмо — без кнопок («Letter: cancelled»),
//        потом удаляется вместе с текущим письмом строки и «Почему?» без ответа (deleteIds). Старше 48 ч Telegram
//        удалить не даст — останется письмо без кнопок.
//   ok = false — только тост: робот в работе (этап 6), письмо ещё пишется (letter_lock моложе 3 мин — как «Unlock stale»),
//        отклик отправлен или вакансия закрыта.

// @include n8n/shared/time.js

// @include n8n/shared/card.js

const action = $('Route').first().json;
// Строка — из «Sent row» по имени (как в «Apply sent»): одна нода Get на кнопки письма, кроме «🔄»
const row = $('Sent row').first().json;

const writing = Boolean(row.letter_lock) && Date.now() - Date.parse(row.letter_lock) < 3 * 60 * 1000;
const refusal = row.apply_state
  ? '🚀 Робот в работе — сначала ⛔ под письмом'
  : writing
    ? '✍️ Письмо ещё пишется — отмени, когда придёт'
    : row.status === 'applied'
      ? row.apply_by === 'me'
        ? '📨 Уже отмечено «Отправил» — сначала «↩️ Отменить»'
        : '📨 Отклик уже отправлен'
      : (FINAL[row.status] ?? '');

return [
  {
    json: {
      id: row.id,
      ok: !refusal,
      toast: refusal || '↩️ Отклик отменён — вакансия снова ждёт решения',
      queryId: action.queryId,
      chatId: action.chatId,
      cardId: row.tg_message_id,
      cardText: cardText({ ...row, status: 'waiting', my_decision: '', my_reason: '' }),
      letterMessageId: action.messageId,
      letterText: [
        `↩️ Отклик отменён · <a href="${row.url}">${esc(row.title)}</a> · ${esc(row.company)}`,
        'Вакансия снова ждёт решения — кнопки на карточке.',
      ].join('\n'),
      // Удалить: письмо, где нажали; текущее письмо строки (если нажали на старом); «Почему?» без ответа
      deleteIds: [...new Set([action.messageId, row.tg_letter_id, row.my_reason ? 0 : row.tg_ask_id].map(Number))].filter(Boolean),
    },
  },
];
