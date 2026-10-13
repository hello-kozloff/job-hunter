// W1 · Plan — какие запросы поиска отправить.
// Нода: Code, режим «Run Once for All Items». Вход: «Settings» — настройки и профиль (⚙️ → 🔎 Поиск, онбординг).
// Запросы (n8n/shared/search.js → searchQueries): удалёнка по всем регионам и, если в профиле офис или гибрид,
// ещё один — в городе человека. По одной странице: 100 последних вакансий с запасом покрывают ночной интервал в 2 часа.
// Бэкфилла (первый запуск без обработки) с 13.10.2026 нет: поиск ограничен периодом (по умолчанию — сутки), и новый
// человек сразу получает карточки.
// Выход: item на запрос { page, label, url, startedAt } → «Search hh» (url); startedAt — начало сбора для «Score job».

// @include n8n/shared/settings.js

// @include n8n/shared/search.js

const s = loadSettings($('Settings').all());
const queries = searchQueries(s);
if (!queries.length) {
  throw new Error('Поиск не настроен: нет ни удалёнки, ни города для офиса и гибрида (⚙️ → 🔎 Поиск или новое резюме)');
}
const startedAt = Date.now();
return queries.map((q) => ({ json: { page: 0, label: q.label, url: searchUrl(0, s, q.params), startedAt } }));
