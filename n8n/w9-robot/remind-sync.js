// W9 · Remind sync — перерисовать панель меню (W7) после напоминания или нажатия на панели 🔔 (6.3).
// Нода: Code, режим «Run Once for All Items». Вход: «Remind done» или «Remind result» → sync.
return $input
  .all()
  .map((i) => i.json.sync)
  .filter(Boolean)
  .slice(0, 1)
  .map((json) => ({ json }));
