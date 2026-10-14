// W5 · Letter sent — что записать в таблицу после отправки письма в Telegram.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы «Send letter» / «Send letter: robot» ({ ok, result: { message_id } } или { error }); письмо к ответу —
// связанный item «Format letter» (itemMatching): после развилки «Robot letter?» индексы не совпадают с «Format letter».
// Выход: обновления строк для «Save letter»: letter, tg_letter_id (на него отвечают с правкой),
//        letter_notes — пожелания пользователя через « | »: идут во все следующие варианты письма этой вакансии
//        (build-letter.js, с 14.10.2026), по ним же правим промпт. То же пожелание дважды — одна запись.

const addWish = (notes, wish) =>
  [...new Set([...String(notes ?? '').split(' | '), wish].map((w) => w.trim()).filter(Boolean))].join(' | ');

return $input.all().flatMap((item, i) => {
  const l = $('Format letter').itemMatching(i)?.json;
  const messageId = item.json.result?.message_id;
  if (!l?.ok || !messageId) return [];
  const notes = l.mode === 'revise' && l.instruction ? addWish(l.letter_notes, l.instruction) : l.letter_notes;
  return [{ json: { id: l.id, letter: l.letter, tg_letter_id: messageId, letter_notes: notes } }];
});
