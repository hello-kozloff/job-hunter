// W9 · Heal items — починка очереди из «Gate» (heal) → по item на запись «Heal».
// Нода: Code, режим «Run Once for All Items». Выход: [{ id, to }] — to: queued (зависла на отправке) | '' (снять)
return ($('Gate').first().json.heal ?? []).map((h) => ({ json: h }));
