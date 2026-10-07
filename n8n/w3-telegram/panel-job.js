// W3 · Panel job — перерисовать панель меню (W7 Bot menu) после решения, принятого в карточке на панели.
// Нода: Code, режим «Run Once for All Items». Выполняется последней: исходная карточка уже перерисована,
// «Почему?» и письмо запущены, строка в таблице записана.
// Выход: задание для W7 { action: 'panel', view: 'open', … } → «Panel refresh» (Execute Workflow, без ожидания).
//   choose = true — нажали «↩️ Изменить»: на панели снова кнопки выбора, хотя решение в строке осталось.

const c = $('Apply choice').first().json;

return [
  {
    json: {
      action: 'panel',
      view: 'open',
      id: c.id,
      tab: c.panel.tab,
      page: c.panel.page,
      chatId: c.chatId,
      messageId: c.panel.messageId,
      userMessageId: 0,
      queryId: '',
      choose: c.keyboard === 'choose',
    },
  },
];
