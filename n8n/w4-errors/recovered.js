// Recovered — открытые тревоги workflow → «✅ снова работает» (07.10.2026). Код одной ноды в W1 и W2:
// успешный запуск закрывает тревоги своего workflow («Close alerts»).
// Нода: Code, режим «Run Once for All Items». Вход: «Open alerts» — открытые тревоги этого workflow
// (Always Output Data: пустой item, если их нет). Выход: одно сообщение { text } или [] — закрывать нечего.

// @include n8n/shared/time.js

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rows = $input
  .all()
  .map((i) => i.json)
  .filter((r) => r.id);
if (!rows.length) return [];

const hits = rows.reduce((n, r) => n + (Number(r.hits) || 1), 0);
const first = Math.min(...rows.map((r) => Date.parse(r.first_at) || Date.now()));
const last = Math.max(...rows.map((r) => Date.parse(r.last_at) || Date.now()));
const span = localHM(first) === localHM(last) ? localHM(first) : `${localHM(first)}–${localHM(last)}`;
return [{ json: { text: `✅ <b>${esc(rows[0].workflow)}</b> снова работает: ошибок было ${hits} (${span} по местному)` } }];
