// W5 · Format letter — сообщение с письмом для Telegram (Parse Mode = HTML), ответом на карточку.
// Нода: Code, режим «Run Once for All Items».
// Вход: «Parse letter»; задание — из «Jobs», вакансия — из «Vacancy».
// Выход: { id, ok, mode, letter, instruction, text, replyTo, apply_url, url, letter_notes } → «Send letter» с кнопками
//   [📝 Отклик на hh] [🔗 Вакансия] / [🔄 Переписать] [📨 Отправил].

// @include n8n/shared/card.js
// @include n8n/shared/letter.js

const jobs = new Map($('Jobs').all().map((i) => [i.json.id, i.json]));
const rows = new Map($('Vacancy').all().map((i) => [i.json.id, i.json]));

return $input.all().map((item) => {
  const r = item.json;
  const job = jobs.get(r.id) ?? {};
  const row = rows.get(r.id) ?? {};
  return {
    json: {
      id: r.id,
      ok: r.ok,
      mode: r.mode,
      letter: r.letter ?? '',
      instruction: job.instruction ?? '',
      // Новое письмо — новая отметка об отклике не нужна: строка остаётся approved
      text: letterText({ ...row, ...r, status: 'approved', instruction: job.instruction }),
      replyTo: row.tg_message_id,
      apply_url: row.apply_url,
      url: row.url,
      letter_notes: row.letter_notes ?? '',
    },
  };
});
