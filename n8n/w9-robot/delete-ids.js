// W9 · Delete ids — фото капчи и ответ пользователя удалить: капча отработана (принята или пришла новая).
// Нода: Code, режим «Run Once for All Items». Вход: «Captcha plan» → deleteIds.
return ($('Captcha plan').first().json.deleteIds ?? []).map((messageId) => ({ json: { messageId } }));
