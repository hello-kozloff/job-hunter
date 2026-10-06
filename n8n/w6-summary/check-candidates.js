// W6 · Check candidates — хвосты, которые надо проверить на hh (список check из «Plan»).
// Нода: Code, режим «Run Once for All Items». Выход: { id, url } → HTTP Request «Vacancy page».

return $('Plan')
  .first()
  .json.check.map((r) => ({ json: { id: r.id, url: r.url } }));
