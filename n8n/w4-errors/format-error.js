// W4 · Format error — текст тревоги для Telegram (Parse Mode = HTML) и ключ проблемы.
// Нода: Code, режим «Run Once for All Items». Вход: Error Trigger.
// Без явного parse mode нода Telegram шлёт Markdown, и «_» в тексте ошибки (dup_key) ломает отправку,
// поэтому шлём HTML и экранируем всё, что пришло из ошибки.
// key — workflow + нода + текст ошибки без чисел и ссылок: повтор той же проблемы (hh отвечает 403 на каждом
// сборе) не шлёт новую тревогу, а правит открытую (07.10.2026, «Alert plan»).

const e = $input.first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Ошибка самого триггера приходит в поле trigger, а не execution
const error = e.execution?.error ?? e.trigger?.error ?? {};
const message = String(error.message ?? 'без текста').slice(0, 1500);
const workflow = String(e.workflow?.name ?? 'workflow');
const node = String(e.execution?.lastNodeExecuted ?? '');

const lines = [
  `❗️ <b>${esc(workflow)}</b>: ошибка`,
  node ? `Нода: ${esc(node)}` : null,
  esc(message),
  e.execution?.url ? esc(e.execution.url) : null,
].filter(Boolean);

const norm = message
  .toLowerCase()
  .replace(/https?:\/\/\S+/g, '')
  .replace(/\d+/g, '#')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 160);

return [{ json: { text: lines.join('\n'), key: `${workflow}|${node}|${norm}`, workflow, message: message.slice(0, 300) } }];
