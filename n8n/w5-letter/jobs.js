// W5 · Jobs — какие письма писать.
// Нода: Code, режим «Run Once for All Items».
// Вход ($input):
//   из W3 (Execute Workflow, «Accept all data») — { id, letter_mode, instruction }:
//     letter_mode = new (нажата ✅) | redo («🔄 Переписать») | revise (ответ на письмо, instruction — пожелание);
//   из Manual → «Approved» — строки status = approved без письма (письма к уже нажатым ✅).
// Выход: { id, mode, instruction }

return $input
  .all()
  .map((i) => i.json)
  .filter((j) => j.id)
  .map((j) => ({
    json: {
      id: Number(j.id),
      mode: ['new', 'redo', 'revise'].includes(j.letter_mode) ? j.letter_mode : 'new',
      instruction: String(j.instruction ?? '').trim(),
    },
  }));
