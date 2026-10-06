// W6 · Plan — что сделать перед утренней сводкой.
// Нода: Code, режим «Run Once for All Items».
// Вход: все строки таблицы vacancies из «All rows».
// Выход: один item { expire, check }:
//   expire — карточки без решения (status = waiting) старше 3 дней → «⌛ устарела», кнопки убрать;
//   check  — хвосты: карточки без решения моложе 3 дней и ✅ без «📨 Отправил» (status = approved) →
//            открыть страницу на hh: закрылась — «🔒 закрыта на hh». Не больше 40 за раз, старые первыми.
// Время карточки — card_at (пишет W2), у старых строк — createdAt.

const DAY = 24 * 3600 * 1000;
const now = Date.now();
const rows = $input.all().map((i) => i.json).filter((r) => r.id);
const cardTime = (r) => Date.parse(r.card_at || r.createdAt) || now;

const waiting = rows.filter((r) => r.status === 'waiting');
const expire = waiting.filter((r) => now - cardTime(r) > 3 * DAY);
const expired = new Set(expire.map((r) => r.id));
const check = [...waiting.filter((r) => !expired.has(r.id)), ...rows.filter((r) => r.status === 'approved')]
  .sort((a, b) => cardTime(a) - cardTime(b))
  .slice(0, 40);

return [{ json: { expire, check } }];
