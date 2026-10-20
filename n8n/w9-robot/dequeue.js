// W9 · Dequeue — робот выключен в ⚙️: очередь назад в ✅, письма — без 🚀 с пометкой «робот выключен».
// Автоотклик выключили (op autostop, 6.1c): его очередь назад в ✅ — письма снова с 🚀, пометка «⛔ убрал из очереди»
// (apply_result = stopped: включённый снова автоотклик её не возьмёт, 🚀 — возьмёт).
// Нода: Code, режим «Run Once for All Items». Вход: строки в очереди (apply_state = queued) из «Queued» / «Auto queued».
// Выход: по item на вакансию: { id, chatId, messageId, layout, result, text, url, apply_url, robot_button } →
//        «Unqueue all» / «Unqueue auto» и «View»

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/robot.js
// @include n8n/shared/letter.js

const autostop = $('Job').first().json.op === 'autostop';
const result = autostop ? 'stopped' : 'disabled';
return $input
  .all()
  .map((i) => i.json)
  .filter((r) => r.id)
  .map((r) => ({
    json: {
      id: r.id,
      chatId: String($env.TG_CHAT_ID),
      messageId: r.tg_letter_id,
      layout: autostop ? 'robot' : 'manual',
      result,
      url: r.url,
      apply_url: r.apply_url,
      robot_button: robotButtonText(r),
      text: letterText({ ...r, apply_state: '', apply_result: result, ok: Boolean(r.letter), mode: 'new' }),
    },
  }));
