// W9 · Auto letter — захваченные автооткликом карточки («Auto claim» отдаёт только те, что удалось захватить) →
// задания W5: новое письмо; auto — W5 напишет его тихо, сам поставит в очередь робота, а не получится — без сообщения
// вернёт карточку в «ждут решения» (6.1c).
// Нода: Code, режим «Run Once for All Items».
return $input
  .all()
  .filter((i) => i.json.id)
  .map((i) => ({ json: { id: i.json.id, letter_mode: 'new', auto: true, replace: [] } }));
