// W6 · Expired done — status = expired для всех устаревших (даже если Telegram не дал изменить карточку).
// Нода: Code, режим «Run Once for All Items». Выход: обновления для «Save expired».

return $('Expire rows')
  .all()
  .map((i) => ({ json: { id: i.json.id, status: 'expired' } }));
