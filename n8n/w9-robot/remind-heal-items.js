// W9 · Remind heal items — починка очереди напоминаний из «Gate» (remindHeal, 6.3) → по item на запись «Remind heal».
// Нода: Code, режим «Run Once for All Items». Выход: [{ id, to }] — to: queued (зависла на отправке) | '' (снять)
return ($('Gate').first().json.remindHeal ?? []).map((h) => ({ json: h }));
