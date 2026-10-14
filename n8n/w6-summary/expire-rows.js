// W6 · Expire rows — карточки без решения старше 3 дней: новый текст карточки без кнопок.
// Нода: Code, режим «Run Once for All Items». Вход: список expire из «Plan».
// Выход: { id, tg_message_id, text } → «Card: expired» (Telegram) → «Expired done» → «Save expired».

// @include n8n/shared/time.js

// @include n8n/shared/card.js

return $('Plan')
  .first()
  .json.expire.map((r) => ({ json: { id: r.id, tg_message_id: r.tg_message_id, text: cardText({ ...r, status: 'expired' }) } }));
