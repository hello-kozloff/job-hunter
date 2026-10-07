// W7 · Unban — «🗑 Убрать» в подтверждении: строка чёрного списка → «Delete ban» (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Выход: [{ id }] или [] — убирать нечего.

const id = Number($('Job').first().json.unban);
return id ? [{ json: { id } }] : [];
