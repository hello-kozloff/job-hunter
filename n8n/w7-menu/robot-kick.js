// W7 · Robot kick — после смены настройки робота (⚙️ → 🚀 Робот, этап 6; 🤖 Автоотклик, 6.1c) подтолкнуть W9 Robot:
//   выключили робота — очередь назад в ✅ (dequeue); выключили автоотклик — его очередь назад в ✅ (autostop);
//   включили, сняли паузу, сменили лимит (и напоминаний, 6.3), запустили автоотклик — обработать очередь (tick).
//   Один вызов на нажатие.
// Нода: Code, режим «Run Once for All Items». Вход: «Setting change» → [{ name, value }]. Не робот — [].
const changes = $('Setting change')
  .all()
  .map((i) => i.json)
  .filter((c) => /^(apply|remind)\./.test(String(c.name ?? '')));
if (!changes.length) return [];
const off = (name) => changes.some((c) => c.name === name && c.value === false);
const op = off('apply.enabled') ? 'dequeue' : off('apply.auto') ? 'autostop' : 'tick';
return [{ json: { op, fromUser: false } }];
