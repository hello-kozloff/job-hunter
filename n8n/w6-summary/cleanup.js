// W6 · Cleanup — убрать описания у отработанных вакансий старше 30 дней (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Своя ветка ниже сводки: выполняется последней.
// Зачем: у таблиц лимит 100 МБ, а меню (W7) на каждое нажатие читает таблицу целиком. Строку не удаляем:
// по external_id и dup_key сбор узнаёт старые вакансии, а в меню видна история.
// Вход: «All rows». Выход: [{ id }] → «Save stripped» (description и snippet = ''), не больше 200 за раз.
// Отклики (applied), ✅ и 🤔 не трогаем: описание может понадобиться для письма и собеседования.

const DAY = 24 * 3600 * 1000;
const now = Date.now();
const DONE = ['rejected', 'skipped', 'expired', 'archived', 'seen'];

return $('All rows')
  .all()
  .map((i) => i.json)
  .filter(
    (r) =>
      r.id && DONE.includes(r.status) && (r.description || r.snippet) && now - (Date.parse(r.updatedAt) || now) > 30 * DAY,
  )
  .slice(0, 200)
  .map((r) => ({ json: { id: r.id } }));
