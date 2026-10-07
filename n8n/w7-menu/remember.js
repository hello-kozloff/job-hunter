// W7 · Remember — запомнить новую панель (или приветствие), чтобы в следующий раз удалить старую.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответ Telegram-ноды раскладки ({ ok, result: { message_id } }; при ошибке правки — { error }).
// Static data (global) сохраняется только у запусков не из редактора (W7 вызывает W3 — режим integrated).

const r = $('Render').first().json;
const id = $input.first().json.result?.message_id;
const state = $getWorkflowStaticData('global');

if (r.view === 'start') {
  if (id) state.greetingId = id;
} else if (!r.edit && id) {
  state.panel = { messageId: id, view: r.view, id: r.id, tab: r.tab, page: r.page };
}
return [];
