// W3 · Reply kind — на что ответил пользователь: на письмо (правка) или на карточку / «почему?» (причина).
// Нода: Code, режим «Run Once for All Items».
// Вход: строка вакансии из «Reply row» (найдена по tg_letter_id, tg_ask_id или tg_message_id = replyTo),
//       сам ответ — из «Route».
// Выход: { id, kind: revise | busy | reason, text }

const reply = $('Route').first().json;
const row = $input.first().json;
return [
  {
    json: {
      id: row.id,
      // Правка письма, пока робот отправляет его (этап 6), не применяется — busy
      kind: row.tg_letter_id === reply.replyTo ? (row.apply_state ? 'busy' : 'revise') : 'reason',
      text: reply.text,
    },
  },
];
