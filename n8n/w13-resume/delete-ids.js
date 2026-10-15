// W13 · Delete ids — вопрос (ForceReply) и ответ человека после того, как ответ записан: в чате остаётся панель.
// Нода: Code, режим «Run Once for All Items». Выход: item на сообщение { chatId, messageId } → «Delete»
// (onError = continue: сообщение уже удалено или старше 48 ч — Telegram не даст удалить, это не ошибка).

const step = $('Step').first().json;
const chatId = $('Job').first().json.chatId;
return (step.deleteIds ?? []).map((messageId) => ({ json: { chatId, messageId } }));
