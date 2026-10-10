// W7 · Robot kick — после смены настройки робота (⚙️ → 🚀 Робот, этап 6) подтолкнуть W9 Robot:
//   выключили робота — очередь назад в ✅ (dequeue); включили, сняли паузу, сменили лимит — обработать очередь (tick).
// Нода: Code, режим «Run Once for All Items». Вход: «Setting change» → { name, value }. Не робот — [].
const change = $('Setting change').first().json;
if (!String(change.name ?? '').startsWith('apply.')) return [];
return [{ json: { op: change.name === 'apply.enabled' && change.value === false ? 'dequeue' : 'tick', fromUser: false } }];
