// W9 · Sync job — перерисовать панель меню (W7), если на ней открыта эта вакансия (как W3 «Sync job»).
// Нода: Code, режим «Run Once for All Items». Вход: «Result» → sync.
return [{ json: $('Result').first().json.sync }];
