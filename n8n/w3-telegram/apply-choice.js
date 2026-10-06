// W3 · Apply choice — нажатие кнопки на карточке → новое состояние строки и карточки.
// Нода: Code, режим «Run Once for All Items».
// Вход: строка вакансии из «Vacancy»; что нажато — из «Route».
// Выход: { id, my_decision, status, text, keyboard, ask, toast, chatId, messageId, queryId }
//   ✅ / 🤔 / ❌ — записать решение, кнопки сменить на «↩️ Изменить» (keyboard = decided).
//     Решение расходится с нейросетью и причины ещё нет → ask: вопрос «почему?» ответом на карточку.
//   ↩️ Изменить (choice = edit) — вернуть кнопки выбора (keyboard = choose), решение не меняется.

// @include n8n/shared/card.js

const action = $('Route').first().json;
const row = $input.first().json;

const out = {
  id: row.id,
  my_decision: row.my_decision ?? '',
  status: row.status,
  keyboard: 'choose',
  ask: '',
  toast: '',
  chatId: action.chatId,
  messageId: action.messageId,
  queryId: action.queryId,
};

if (action.choice !== 'edit') {
  out.my_decision = action.choice;
  out.status = STATUS_BY_CHOICE[action.choice];
  out.keyboard = 'decided';
  out.toast = `Записал: ${CHOICE[action.choice]}`;
  const known = ['apply', 'maybe', 'skip'].includes(row.decision);
  if (known && row.decision !== action.choice && !row.my_reason) {
    out.ask =
      `🤖 ${VERDICT[row.decision]} · 👤 ${CHOICE[action.choice]}\n` +
      'Почему? Ответь на это сообщение одной фразой — по ответам поправлю правила.';
  }
}
out.text = cardText({ ...row, my_decision: out.my_decision });

return [{ json: out }];
