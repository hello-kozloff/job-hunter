// W3 · Route — разбор обновления от Telegram Trigger (callback_query и message).
// Нода: Code, режим «Run Once for All Items».
// Выход: один item или [] (не наше — игнорируем):
//   { action: 'choice', id, choice, queryId, chatId, messageId } — нажата кнопка карточки.
//      callback_data = v:<id строки>:<apply|maybe|skip|edit>; messageId — id карточки.
//   { action: 'letter', id, op, queryId, chatId, messageId } — кнопка под письмом (W5):
//      callback_data = l:<id строки>:<redo|sent|unsent>; messageId — сообщение с письмом.
//   { action: 'reply', replyTo, messageId, chatId, text } — ответ (reply) на вопрос «почему?», карточку или письмо.
// Чужие чаты отсекает сам Telegram Trigger (Restrict to Chat IDs = TG_CHAT_ID); здесь — вторая проверка.

const update = $input.first().json;
const allowed = String($env.TG_CHAT_ID ?? '');
const ours = (chatId) => !allowed || String(chatId) === allowed;

const cb = update.callback_query;
if (cb) {
  if (!ours(cb.message?.chat?.id)) return [];
  const letter = String(cb.data ?? '').match(/^l:(\d+):(redo|sent|unsent)$/);
  if (letter) {
    return [
      {
        json: {
          action: 'letter',
          id: Number(letter[1]),
          op: letter[2],
          queryId: cb.id,
          chatId: String(cb.message.chat.id),
          messageId: cb.message.message_id,
        },
      },
    ];
  }
  const match = String(cb.data ?? '').match(/^v:(\d+):(apply|maybe|skip|edit)$/);
  if (!match) return [];
  return [
    {
      json: {
        action: 'choice',
        id: Number(match[1]),
        choice: match[2],
        queryId: cb.id,
        chatId: String(cb.message.chat.id),
        messageId: cb.message.message_id,
      },
    },
  ];
}

const msg = update.message;
const text = String(msg?.text ?? '').trim();
// Команды бота (/start и т. п.) и сообщения без reply не обрабатываем
if (msg?.reply_to_message && text && !text.startsWith('/') && ours(msg.chat?.id)) {
  return [
    {
      json: {
        action: 'reply',
        replyTo: msg.reply_to_message.message_id,
        messageId: msg.message_id,
        chatId: String(msg.chat.id),
        text: text.slice(0, 500),
      },
    },
  ];
}
return [];
