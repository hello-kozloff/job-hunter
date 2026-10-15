// W1 · Plan — какие запросы поиска отправить.
// Нода: Code, режим «Run Once for All Items». Вход: «Settings» — настройки и профиль (⚙️ → 🔎 Поиск, онбординг).
// Запросы (n8n/shared/search.js → searchQueries): удалёнка по всем регионам и, если в профиле офис или гибрид,
// ещё один — в городе человека. По одной странице: 100 последних вакансий с запасом покрывают ночной интервал в 2 часа.
// Бэкфилла (первый запуск без обработки) с 13.10.2026 нет: поиск ограничен периодом (по умолчанию — сутки), и новый
// человек сразу получает карточки.
// Несколько резюме (16.10.2026, docs/resumes.md): запросы — по каждому активному резюме (до MAX_SEARCH_RESUMES) с его
// словами, ролями и городом; одинаковые адреса склеиваются, вакансию получает первое резюме.
// Выход: item на запрос { page, label, url, startedAt, resumeId } → «Search hh» (url); startedAt — начало сбора
// для «Score job»; resumeId — пусто у основного резюме (r1), «Parse search» ставит его (и resumeName) вакансиям.

// @include n8n/shared/settings.js

// @include n8n/shared/search.js

// @include n8n/shared/resumes.js

const s = loadSettings($('Settings').all());
const startedAt = Date.now();
// При одном резюме названия запросов прежние; при нескольких — с названием резюме
const several = resumeList(s).length > 1;
const seen = new Set();
const items = [];
for (const r of activeResumes(s).slice(0, MAX_SEARCH_RESUMES)) {
  const rs = resumeSettings(s, r.id);
  for (const q of searchQueries(rs)) {
    const url = searchUrl(0, rs, q.params);
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({
      json: { page: 0, label: several ? `${r.name}: ${q.label}` : q.label, url, startedAt, resumeId: r.id === 'r1' ? '' : r.id, resumeName: r.name },
    });
  }
}
if (!items.length) {
  throw new Error('Поиск не настроен: нет ни удалёнки, ни города для офиса и гибрида (⚙️ → 🔎 Поиск или новое резюме)');
}
return items;
