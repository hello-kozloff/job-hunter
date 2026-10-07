// Recovered — открытые тревоги workflow → «✅ снова работает» (07.10.2026). Код одной ноды в W1 и W2:
// успешный запуск закрывает тревоги своего workflow («Close alerts»).
// Нода: Code, режим «Run Once for All Items». Вход: «Open alerts» — открытые тревоги этого workflow
// (Always Output Data: пустой item, если их нет). Выход: одно сообщение { text } или [] — закрывать нечего.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rows = $input
  .all()
  .map((i) => i.json)
  .filter((r) => r.id);
if (!rows.length) return [];

const thai = (ms) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(11, 16);
const hits = rows.reduce((n, r) => n + (Number(r.hits) || 1), 0);
const first = Math.min(...rows.map((r) => Date.parse(r.first_at) || Date.now()));
const last = Math.max(...rows.map((r) => Date.parse(r.last_at) || Date.now()));
const span = thai(first) === thai(last) ? thai(first) : `${thai(first)}–${thai(last)}`;
return [{ json: { text: `✅ <b>${esc(rows[0].workflow)}</b> снова работает: ошибок было ${hits} (${span} по Таиланду)` } }];
