// W11 · Job — что пришло: документ, кнопка pf:* или ответ на вопрос профиля (W3 «Route», 13.10.2026).
// Нода: Code, режим «Run Once for All Items». Ручной запуск (Manual) — панель профиля (op view), без кнопки.
// Выход: { op, field, value, text, file, chatId, queryId, messageId, userMessageId, promptId, username }.

const j = $input.first().json;
return [
  {
    json: {
      op: j.op ?? 'view',
      field: String(j.field ?? ''),
      value: String(j.value ?? ''),
      text: String(j.text ?? ''),
      file: j.file ?? null,
      chatId: String(j.chatId || $env.TG_CHAT_ID),
      queryId: String(j.queryId ?? ''),
      messageId: Number(j.messageId) || 0,
      userMessageId: Number(j.userMessageId) || 0,
      promptId: Number(j.promptId) || 0,
      username: String(j.username ?? ''),
    },
  },
];
