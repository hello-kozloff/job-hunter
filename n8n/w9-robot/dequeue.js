// W9 · Dequeue — робот выключен в ⚙️: очередь назад в ✅, письма — без 🚀 с пометкой «робот выключен».
// Нода: Code, режим «Run Once for All Items». Вход: строки в очереди (apply_state = queued) из «Queued».
// Выход: по item на вакансию: { id, chatId, messageId, layout: manual, text, url, apply_url } → «Unqueue all» и «View»

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/robot.js
// @include n8n/shared/letter.js

return $input
  .all()
  .map((i) => i.json)
  .filter((r) => r.id)
  .map((r) => ({
    json: {
      id: r.id,
      chatId: String($env.TG_CHAT_ID),
      messageId: r.tg_letter_id,
      layout: 'manual',
      url: r.url,
      apply_url: r.apply_url,
      text: letterText({ ...r, apply_state: '', apply_result: 'disabled', ok: Boolean(r.letter), mode: 'new' }),
    },
  }));
