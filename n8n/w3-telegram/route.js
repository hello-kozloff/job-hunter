// W3 · Route — разбор обновления от Telegram Trigger (callback_query и message).
// Нода: Code, режим «Run Once for All Items».
// Выход: один item или [] (не наше — игнорируем):
//   { action: 'choice', id, choice, queryId, chatId, messageId, panel } — нажата кнопка решения.
//      callback_data = v:<id строки>:<apply|maybe|skip|edit> — на карточке; messageId — id карточки, panel = null;
//      callback_data = pv:<id>:<choice>:<tab>:<page> — в карточке на панели меню (W7):
//      panel = { messageId, tab, page } — панель перерисуется после решения.
//   { action: 'letter', id, op, queryId, chatId, messageId } — кнопка под письмом (W5):
//      callback_data = l:<id строки>:<redo|sent|unsent>; messageId — сообщение с письмом.
//   { action: 'reply', replyTo, messageId, chatId, text } — ответ (reply) на вопрос «почему?», карточку или письмо.
//   { action: 'panel', view, tab, page, id, chatId, queryId, messageId, userMessageId } — меню бота → W7 Bot menu:
//      кнопки под полем ввода («📋 Вакансии», «📊 Статистика»), команды /start, /menu, /vacancies, /stats, /v<id>
//      и кнопки панели (callback_data p:…). view = list | stats | start | open | noop;
//      messageId — панель, где нажали кнопку (правим её); userMessageId — сообщение пользователя (удалить).
// Чужие чаты отсекает сам Telegram Trigger (Restrict to Chat IDs = TG_CHAT_ID); здесь — вторая проверка.

// @include n8n/shared/menu.js

const update = $input.first().json;
const allowed = String($env.TG_CHAT_ID ?? '');
const ours = (chatId) => !allowed || String(chatId) === allowed;
const panel = (fields) => [
  { json: { action: 'panel', tab: '', page: 1, id: 0, queryId: '', messageId: 0, userMessageId: 0, ...fields } },
];

const cb = update.callback_query;
if (cb) {
  if (!ours(cb.message?.chat?.id)) return [];
  const data = String(cb.data ?? '');
  const chatId = String(cb.message.chat.id);
  const pressed = { chatId, queryId: cb.id, messageId: cb.message.message_id };

  const list = data.match(/^p:l:([a-z]+):(\d+)$/);
  if (list && TABS[list[1]]) return panel({ ...pressed, view: 'list', tab: list[1], page: Number(list[2]) });
  if (data === 'p:s') return panel({ ...pressed, view: 'stats' });
  if (data === 'p:x') return panel({ ...pressed, view: 'noop' });

  const letter = data.match(/^l:(\d+):(redo|sent|unsent)$/);
  if (letter) {
    return [{ json: { action: 'letter', id: Number(letter[1]), op: letter[2], ...pressed } }];
  }
  const fromPanel = data.match(/^pv:(\d+):(apply|maybe|skip|edit):([a-z]+):(\d+)$/);
  if (fromPanel) {
    const tab = TABS[fromPanel[3]] ? fromPanel[3] : 'all';
    return [
      {
        json: {
          action: 'choice',
          id: Number(fromPanel[1]),
          choice: fromPanel[2],
          ...pressed,
          panel: { messageId: cb.message.message_id, tab, page: Number(fromPanel[4]) },
        },
      },
    ];
  }
  const match = data.match(/^v:(\d+):(apply|maybe|skip|edit)$/);
  if (!match) return [];
  return [{ json: { action: 'choice', id: Number(match[1]), choice: match[2], ...pressed, panel: null } }];
}

const msg = update.message;
if (!msg || !ours(msg.chat?.id)) return [];
const text = String(msg.text ?? '').trim();
const typed = { chatId: String(msg.chat.id), userMessageId: msg.message_id };

// Кнопки под полем ввода и команды: /v169 → [v, 169], /stats@bot → [stats, '']
const command = text.match(/^\/([a-z]+)(\d*)(?:@\w+)?(?:\s|$)/i);
const name = command?.[1].toLowerCase();
if (text === MENU.list || name === 'vacancies') return panel({ ...typed, view: 'list' });
if (text === MENU.stats || name === 'stats') return panel({ ...typed, view: 'stats' });
if (name === 'start' || name === 'menu') return panel({ ...typed, view: 'start' });
if (name === 'v' && command[2]) return panel({ ...typed, view: 'open', id: Number(command[2]) });

// Остальные команды и сообщения без reply не обрабатываем
if (msg.reply_to_message && text && !text.startsWith('/')) {
  return [
    {
      json: {
        action: 'reply',
        replyTo: msg.reply_to_message.message_id,
        messageId: msg.message_id,
        chatId: typed.chatId,
        text: text.slice(0, 500),
      },
    },
  ];
}
return [];
