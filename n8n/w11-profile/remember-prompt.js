// W11 · Remember prompt — запомнить вопрос «➕ Новое резюме» (ForceReply): когда придёт PDF, «Step» его удалит.
// Нода: Code, режим «Run Once for All Items». Вход: ответ Telegram-ноды «Prompt» ({ ok, result: { message_id } }).
// Остальные вопросы (подпись, дополнение…) удаляет ответ на них, их не запоминаем: только когда «Step» ждёт файл
// (awaitPrompt). Static data сохраняется только у запусков не из редактора (W11 вызывает W3 — режим integrated).

const id = $input.first().json.result?.message_id;
if (id && $('Step').first().json.awaitPrompt) $getWorkflowStaticData('global').promptId = id;
return [];
