// W3 · Sync job — обновить панель меню (W7 Bot menu), если на ней открыта эта вакансия:
//   решение на карточке в ленте («Apply choice», не из панели), «📨 Отправил» / «↩️ Отменить» под письмом
//   («Apply sent») или «↩️ Отменить отклик» («Apply cancel») — кнопки решения на панели должны совпадать с карточкой в ленте.
// Нода: Code, режим «Run Once for All Items». Открыта другая вакансия или список — W7 ничего не делает.
// Выход: { action: 'panel', view: 'sync', id, choose, … } → «Panel sync» (Execute Workflow, без ожидания).

const from = (name) => {
  try {
    return $(name).first().json;
  } catch {
    return null; // нода не выполнялась в этом запуске
  }
};
const cancel = from('Apply cancel');
const sent = cancel ? null : from('Apply sent');
const choice = cancel || sent ? null : from('Apply choice');
const s = cancel ?? sent ?? choice;

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
      // «↩️ Изменить» на карточке в ленте — на панели тоже кнопки выбора
      choose: choice?.keyboard === 'choose',
    },
  },
];
