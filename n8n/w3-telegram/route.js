// W3 · Route — разбор обновления от Telegram Trigger (callback_query и message).
// Нода: Code, режим «Run Once for All Items».
// Выход: один item или [] (не наше — игнорируем):
//   { action: 'choice', id, choice, queryId, chatId, messageId, panel } — нажата кнопка решения.
//      callback_data = v:<id строки>:<apply|maybe|skip|earlier|edit> — на карточке; messageId — id карточки, panel = null;
//      callback_data = pv:<id>:<choice>:<tab>:<page> — в карточке на панели меню (W7; score — «🤖 На оценку» у отсеянной):
//      panel = { messageId, tab, page } — панель перерисуется после решения.
//   { action: 'letter', id, op, queryId, chatId, messageId } — кнопка под письмом (W5):
//      callback_data = l:<id строки>:<redo|sent|unsent>; messageId — сообщение с письмом.
//   { action: 'robot', op, id, queryId, chatId, messageId, text, promptId, userMessageId } — робот-отклик (этап 6) →
//      W9 Robot: l:<id>:robot — 🚀 (op enqueue), l:<id>:stop — ⛔ (op stop), rb:go и команда /go — ▶️ после блока
//      (op resume), ответ на фото капчи (подпись начинается с ROBOT_PROMPTS.captcha) — op captcha, text — ответ.
//   { action: 'reply', replyTo, messageId, chatId, text } — ответ (reply) на вопрос «почему?», карточку или письмо.
//   { action: 'panel', view, tab, page, id, chatId, queryId, messageId, userMessageId } — меню бота → W7 Bot menu:
//      кнопки под полем ввода («📋 Вакансии», «📊 Статистика», «⚙️ Настройки»), команды /start, /menu, /vacancies,
//      /stats, /settings, /v<id> и кнопки панели (callback_data p:…, s:…, sc:…, sn).
//      view = list | stats | start | open | noop | sync | settings;
//      settings: section — раздел, change = { name, toggle? } — следующее значение настройки или правило фильтра,
//      collectNow — собрать сейчас, ask — вопрос со списком, input = { name, text } — ответ на него (promptId — вопрос),
//      unban — убрать компанию из чёрного списка, id — компания для подтверждения (/bl<id>);
//      resume = true — список там, где был (p:n — «📋 К вакансиям» под письмом: новая панель, не правка письма);
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
  if (data === 'p:n') return panel({ chatId, queryId: cb.id, view: 'list', resume: true });
  if (data === 'p:x') return panel({ ...pressed, view: 'noop' });

  // ⚙️ Настройки (W7): раздел, следующее значение настройки, «🔄 Собрать сейчас»
  const section = data.match(/^s:([a-z]+)$/);
  if (section) return panel({ ...pressed, view: 'settings', section: section[1] });
  const change = data.match(/^sc:([a-z_.]+)$/);
  if (change) {
    return panel({ ...pressed, view: 'settings', section: change[1].split('.')[0], change: { name: change[1] } });
  }
  if (data === 'sn') return panel({ ...pressed, view: 'settings', section: 'collect', collectNow: true });
  const toggle = data.match(/^st:([a-z_]+)$/);
  if (toggle) {
    return panel({ ...pressed, view: 'settings', section: 'rules', change: { name: 'filter.rules_off', toggle: toggle[1] } });
  }
  const ask = data.match(/^sw:([a-z_.]+)$/);
  if (ask && SETTING_PROMPTS[ask[1]]) {
    return panel({ ...pressed, view: 'settings', section: ask[1].split('.')[0], ask: ask[1] });
  }
  const unban = data.match(/^bld:(\d+)$/);
  if (unban) return panel({ ...pressed, view: 'settings', section: 'blacklist', unban: Number(unban[1]) });

  // Робот-отклик (этап 6): 🚀 под письмом, ⛔ из очереди, ▶️ после блока → W9 Robot
  const robot = data.match(/^l:(\d+):(robot|stop)$/);
  if (robot) {
    return [{ json: { action: 'robot', op: robot[2] === 'robot' ? 'enqueue' : 'stop', id: Number(robot[1]), ...pressed } }];
  }
  if (data === 'rb:go') return [{ json: { action: 'robot', op: 'resume', id: 0, ...pressed } }];

  const letter = data.match(/^l:(\d+):(redo|sent|unsent)$/);
  if (letter) {
    return [{ json: { action: 'letter', id: Number(letter[1]), op: letter[2], ...pressed } }];
  }
  const fromPanel = data.match(/^pv:(\d+):(apply|maybe|skip|earlier|ban|edit|score):([a-z]+):(\d+)$/);
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
  const match = data.match(/^v:(\d+):(apply|maybe|skip|earlier|ban|edit)$/);
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
if (text === MENU.settings || name === 'settings') return panel({ ...typed, view: 'settings', section: 'root' });
if (name === 'start' || name === 'menu') return panel({ ...typed, view: 'start' });
if (name === 'v' && command[2]) return panel({ ...typed, view: 'open', id: Number(command[2]) });
// /bl12 — убрать компанию из чёрного списка (панель спросит подтверждение)
if (name === 'bl' && command[2]) return panel({ ...typed, view: 'settings', section: 'unban', id: Number(command[2]) });
// /go — робот, продолжай (после капчи или входа через «Общий экран»)
const robotJob = (fields) => [{ json: { action: 'robot', id: 0, queryId: '', messageId: 0, ...typed, ...fields } }];
if (name === 'go') return robotJob({ op: 'resume' });

// Ответ на фото капчи (W9): у фото нет text — подпись в caption
const replied = msg.reply_to_message;
if (replied && text && String(replied.caption ?? replied.text ?? '').startsWith(ROBOT_PROMPTS.captcha)) {
  return robotJob({ op: 'captcha', text: text.slice(0, 40), promptId: replied.message_id });
}

// Ответ на вопрос ⚙️ со списком — новый список (вопрос узнаём по началу его текста)
const prompt = Object.keys(SETTING_PROMPTS).find((key) =>
  String(msg.reply_to_message?.text ?? '').startsWith(SETTING_PROMPTS[key]),
);
if (prompt && text) {
  return panel({
    ...typed,
    view: 'settings',
    section: prompt.split('.')[0],
    input: { name: prompt, text: text.slice(0, 1000) },
    promptId: msg.reply_to_message.message_id,
  });
}

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
