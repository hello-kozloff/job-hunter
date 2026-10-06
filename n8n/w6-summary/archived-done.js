// W6 · Archived done — status = archived для закрытых на hh.
// Нода: Code, режим «Run Once for All Items». Выход: обновления для «Save archived».

return $('Archive status')
  .all()
  .map((i) => ({ json: { id: i.json.id, status: 'archived' } }));
