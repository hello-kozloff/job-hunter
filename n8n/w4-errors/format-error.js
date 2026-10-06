// W4 · Format error — текст тревоги для Telegram (Parse Mode = HTML).
// Нода: Code, режим «Run Once for All Items». Вход: Error Trigger.
// Без явного parse mode нода Telegram шлёт Markdown, и «_» в тексте ошибки (dup_key) ломает отправку,
// поэтому шлём HTML и экранируем всё, что пришло из ошибки.

const e = $input.first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Ошибка самого триггера приходит в поле trigger, а не execution
const error = e.execution?.error ?? e.trigger?.error ?? {};
const message = String(error.message ?? 'без текста').slice(0, 1500);

const lines = [
  `❗️ <b>${esc(e.workflow?.name ?? 'workflow')}</b>: ошибка`,
  e.execution?.lastNodeExecuted ? `Нода: ${esc(e.execution.lastNodeExecuted)}` : null,
  esc(message),
  e.execution?.url ? esc(e.execution.url) : null,
].filter(Boolean);

return [{ json: { text: lines.join('\n') } }];
