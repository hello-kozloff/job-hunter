// W1 · Plan — какие запросы поиска отправить.
// Нода: Code, режим «Run Once for All Items». Вход: «Settings» — настройки и профиль (⚙️ → 🔎 Поиск, онбординг);
// «Last ok» — последний успешный сбор из журнала runs (догон после простоя).
// Запросы (n8n/shared/search.js → searchQueries): удалёнка по всем регионам и, если в профиле офис или гибрид,
// ещё один — в городе человека. По одной странице: 100 последних вакансий с запасом покрывают ночной интервал в 2 часа.
// Бэкфилла (первый запуск без обработки) с 13.10.2026 нет: поиск ограничен периодом (по умолчанию — сутки), и новый
// человек сразу получает карточки.
// Несколько резюме (16.10.2026, docs/resumes.md): запросы — по каждому активному резюме (до MAX_SEARCH_RESUMES) с его
// словами, ролями и городом; одинаковые адреса склеиваются, вакансию получает первое резюме.
// Догон после простоя (19.10.2026): успешного сбора не было дольше суток (Mac спал, сбор падал) — период шире (3 или
// 7 дней) и до 3 страниц, иначе вакансии старше периода не нашлись бы никогда. Обычный сбор — как раньше.
// Выход: item на страницу запроса { page, label, url, startedAt, resumeId, resumeName, period, catchup, gapHours,
// pages } → «Search hh» (url); startedAt — начало сбора для «Score job»; resumeId — пусто у основного резюме (r1),
// resumeName — название резюме, пока резюме больше одного (подпись «📄 Резюме» в карточке, у основного тоже), иначе
// пусто. «Parse search» ставит оба вакансиям. period, catchup, gapHours, pages — для сообщения о сборе.

// @include n8n/shared/settings.js

// @include n8n/shared/search.js

// @include n8n/shared/resumes.js

const DAY = 24 * 3600 * 1000;
const s = loadSettings($('Settings').all());
const startedAt = Date.now();

// Разрыв с последним успешным сбором (с запасом 2 ч). Нет ни одного — как раньше
let lastOk = 0;
try {
  lastOk = Date.parse($('Last ok').first()?.json?.started_at) || 0;
} catch {
  // ноды «Last ok» нет в этом запуске — как раньше
}
const gapDays = lastOk ? (startedAt - lastOk) / DAY + 2 / 24 : 0;
const catchup = gapDays > 1;
// Период — наименьший из тех, что знает hh, но не меньше настройки; страниц больше одной — только при догоне
const period = [1, 3, 7].find((p) => p >= Math.max(s['search.period'], gapDays)) ?? 7;
const pages = catchup ? { 1: 1, 3: 2, 7: 3 }[period] : 1;
const gapHours = catchup ? Math.round((startedAt - lastOk) / 3600000) : 0;

// При одном резюме названия запросов прежние; при нескольких — с названием резюме
const several = resumeList(s).length > 1;
const seen = new Set();
const items = [];
for (const r of activeResumes(s).slice(0, MAX_SEARCH_RESUMES)) {
  const rs = { ...resumeSettings(s, r.id), 'search.period': period };
  // Без слов для поиска искать нечего (у основного резюме слова есть всегда)
  if (!resumeSearchable(rs)) continue;
  for (const q of searchQueries(rs)) {
    for (let page = 0; page < pages; page++) {
      const url = searchUrl(page, rs, q.params);
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({
        json: {
          page,
          label: several ? `${r.name}: ${q.label}` : q.label,
          url,
          startedAt,
          resumeId: r.id === 'r1' ? '' : r.id,
          resumeName: several ? r.name : '',
          period,
          catchup,
          gapHours,
          pages,
        },
      });
    }
  }
}
if (!items.length) {
  throw new Error('Поиск не настроен: нет ни удалёнки, ни города для офиса и гибрида (⚙️ → 🔎 Поиск или новое резюме)');
}
return items;
