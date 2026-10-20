// W9 · Job — что делать роботу: команда от W3 / W7 / W10 / самого W9 или тик расписания.
// Нода: Code, режим «Run Once for All Items». Вход: item триггера («Called» — что прислал вызвавший; «Schedule»,
// «Manual» — без команды → tick).
// Выход: { op, id, queryId, chatId, messageId, text, promptId, userMessageId, fromUser, auto }
//   op: enqueue — 🚀 под письмом (W3); stop — ⛔ (W3); tick — обработать очередь (расписание, сам W9, W7, W10);
//       resume — ▶️ или /go после блока (W3); captcha — ответ на фото капчи (W3); dequeue — робот выключен в ⚙️ (W7);
//       autostop — автоотклик выключили (W7, 6.1c): его очередь — назад в ✅
//   fromUser — запуск по нажатию: его письмо W9 сразу перерисует, если робот ждёт (капча, вход, лимит)
//   auto — enqueue от автоотклика (W5 после письма, сам W9 «Feed»): не нажатие, в очередь с apply_mode = auto

const j = $input.first()?.json ?? {};
const OPS = ['enqueue', 'stop', 'tick', 'resume', 'captcha', 'dequeue', 'autostop'];
const op = OPS.includes(j.op) ? j.op : 'tick';
const auto = op === 'enqueue' && Boolean(j.auto);
return [
  {
    json: {
      op,
      id: Number(j.id) || 0,
      queryId: String(j.queryId ?? ''),
      chatId: String(j.chatId || $env.TG_CHAT_ID),
      messageId: Number(j.messageId) || 0,
      text: String(j.text ?? '').trim().slice(0, 40),
      promptId: Number(j.promptId) || 0,
      userMessageId: Number(j.userMessageId) || 0,
      fromUser: j.fromUser !== undefined ? Boolean(j.fromUser) : !auto && ['enqueue', 'stop', 'resume', 'captcha'].includes(op),
      auto,
    },
  },
];
