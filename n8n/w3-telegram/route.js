// W3 · Route — разбор обновления от Telegram Trigger (callback_query и message).
// Нода: Code, режим «Run Once for All Items».
// Выход: один item или [] (не наше — игнорируем):
//   { action: 'choice', id, choice, queryId, chatId, messageId } — нажата кнопка карточки.
//      callback_data = v:<id строки>:<apply|maybe|skip|edit>; messageId — id карточки.
//   { action: 'reason', replyTo, messageId, chatId, text } — ответ (reply) на вопрос «почему?» или на карточку.
// Чужие чаты отсекает сам Telegram Trigger (Restrict to Chat IDs = TG_CHAT_ID); здесь — вторая проверка.

const update = $input.first().json;
const allowed = String($env.TG_CHAT_ID ?? '');
const ours = (chatId) => !allowed || String(chatId) === allowed;

const cb = update.callback_query;
if (cb) {
  const match = String(cb.data ?? '').match(/^v:(\d+):(apply|maybe|skip|edit)$/);
  if (!match || !ours(cb.message?.chat?.id)) return [];
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
        action: 'reason',
        replyTo: msg.reply_to_message.message_id,
        messageId: msg.message_id,
        chatId: String(msg.chat.id),
        text: text.slice(0, 500),
      },
    },
  ];
}
return [];
