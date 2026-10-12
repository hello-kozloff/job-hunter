// W9 · Remember — запомнить отправленную тревогу или фото капчи (static data global):
//   alertMessageId — тревога о блоке: когда блок снимут, «Gate» поправит её на «✅ снова в работе»;
//   captchaPromptId — фото капчи (ответ на него — текст капчи; W3 узнаёт ответ по подписи).
// Нода: Code, режим «Run Once for All Items». Вход: ответ Telegram { result: { message_id } } или { error }.
const state = $getWorkflowStaticData('global');
const sent = $input.first()?.json?.result?.message_id;
const kind = $('Notice item').first()?.json?.notice?.kind;
if (sent && kind === 'captcha') state.captchaPromptId = sent;
else if (sent) state.alertMessageId = sent;
return [{ json: { messageId: sent ?? 0 } }];
