// W1 · Plan — какие страницы поиска запрашивать.
// Нода: Code, режим «Run Once for All Items».
// Вход: нода «Any row» (Data Table → Get, Limit 1, Settings → Always Output Data = on).
//       Если таблица пустая, приходит пустой item без id.
// Первый запуск (таблица пустая) = бэкфилл: страницы 0 и 1, всё пишется со статусом seen.
// Обычный запуск: только страница 0 — 100 последних вакансий с запасом покрывают ночной интервал в 2 часа.
// startedAt — начало сбора для сообщения о сборе («Score job»).

const firstRun = !$input.first().json.id;
const pages = firstRun ? [0, 1] : [0];
const startedAt = Date.now();

return pages.map((page) => ({ json: { page, firstRun, startedAt } }));
