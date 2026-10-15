// W13 · Remember — запомнить новую панель: ответы на вопросы (ForceReply) правят её, а не шлют новую.
// Нода: Code, режим «Run Once for All Items». Вход: ответ Telegram-ноды «New: …» ({ ok, result: { message_id } }).
// Static data сохраняется только у запусков не из редактора (W13 вызывает W3 — режим integrated).

const id = $input.first().json.result?.message_id;
if (id) $getWorkflowStaticData('global').panelId = id;
return [];
