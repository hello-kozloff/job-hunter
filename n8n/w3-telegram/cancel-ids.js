// W3 · Cancel ids — что удалить после «↩️ Отменить отклик»: письмо, текущее письмо строки и «Почему?» без ответа.
// Нода: Code, режим «Run Once for All Items». Вход: «Apply cancel» → deleteIds.
// Выход: item на сообщение { messageId } → «Delete cancelled» (onError = continue: старше 48 ч Telegram удалить не даёт).
return ($('Apply cancel').first().json.deleteIds ?? []).map((messageId) => ({ json: { messageId } }));
