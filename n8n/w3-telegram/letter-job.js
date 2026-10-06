// W3 · Letter job — задание для W5 Letter: { id, letter_mode, instruction }.
// Нода: Code, режим «Run Once for All Items». В неё ведут три ветки — в запуске работает одна:
//   ✅ на карточке и письма ещё нет («Apply choice», need_letter) → new;
//   «🔄 Переписать» под письмом («Route», action = letter) → redo;
//   ответ на письмо («Reply kind», kind = revise) → revise, instruction — текст ответа.

const from = (name) => {
  try {
    return $(name).first().json;
  } catch {
    return null; // нода не выполнялась в этом запуске
  }
};
const reply = from('Reply kind');
const route = from('Route');
const choice = from('Apply choice');

if (reply?.kind === 'revise') return [{ json: { id: reply.id, letter_mode: 'revise', instruction: reply.text } }];
if (route?.action === 'letter') return [{ json: { id: route.id, letter_mode: 'redo', instruction: '' } }];
if (choice?.need_letter) return [{ json: { id: choice.id, letter_mode: 'new', instruction: '' } }];
return [];
