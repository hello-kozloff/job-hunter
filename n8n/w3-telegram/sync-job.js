// W3 · Sync job — после «📨 Отправил» / «↩️ Отменить» под письмом обновить панель меню (W7 Bot menu):
// если на ней открыта эта вакансия, кнопки решения должны исчезнуть (отклик отправлен) или вернуться.
// Нода: Code, режим «Run Once for All Items». Открыта другая вакансия или список — W7 ничего не делает.
// Выход: { action: 'panel', view: 'sync', id, … } → «Panel sync» (Execute Workflow, без ожидания).

const s = $('Apply sent').first().json;

return [
  {
    json: {
      action: 'panel',
      view: 'sync',
      id: s.id,
      chatId: s.chatId,
      tab: '',
      page: 1,
      queryId: '',
      messageId: 0,
      userMessageId: 0,
    },
  },
];
