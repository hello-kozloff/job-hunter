// W5 · Letter sent — что записать в таблицу после отправки письма в Telegram.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы «Send letter» / «Send letter: robot» ({ ok, result: { message_id } } или { error }); письмо к ответу —
// связанный item «Format letter» (itemMatching): после развилки «Robot letter?» индексы не совпадают с «Format letter».
// Выход: обновления строк для «Save letter»: letter, tg_letter_id (на него отвечают с правкой),
//        letter_notes — пожелания пользователя через « | » (по ним потом правим промпт).

return $input.all().flatMap((item, i) => {
  const l = $('Format letter').itemMatching(i)?.json;
  const messageId = item.json.result?.message_id;
  if (!l?.ok || !messageId) return [];
  const notes = l.mode === 'revise' && l.instruction ? [l.letter_notes, l.instruction].filter(Boolean).join(' | ') : l.letter_notes;
  return [{ json: { id: l.id, letter: l.letter, tg_letter_id: messageId, letter_notes: notes } }];
});
