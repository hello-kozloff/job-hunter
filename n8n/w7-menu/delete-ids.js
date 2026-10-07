// W7 · Delete ids — что удалить после отправки новой панели: нажатие пользователя и прошлую панель.
// Нода: Code, режим «Run Once for All Items». Одна живая панель в чате (решение пользователя 07.10.2026).
// Выход: item на сообщение { chatId, messageId } → «Delete old» (onError = continue: сообщение уже удалено
// или старше 48 ч — Telegram не даст удалить, это не ошибка).

const r = $('Render').first().json;
return (r.deleteIds ?? []).map((messageId) => ({ json: { chatId: r.chatId, messageId } }));
