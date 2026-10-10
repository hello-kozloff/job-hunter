// W3 · Apply choice — нажатие кнопки на карточке → новое состояние строки и карточки.
// Нода: Code, режим «Run Once for All Items».
// Вход: строка вакансии из «Vacancy»; что нажато — из «Route».
// Выход: { id, my_decision, status, text, keyboard, ask, toast, need_letter, chatId, messageId, queryId, panel }
//   messageId — исходная карточка в ленте: её перерисовывают «Card: …», на неё отвечает «Почему?».
//   Решение из карточки на панели меню (panel, callback_data pv:…) — тоже правит исходную карточку
//   (row.tg_message_id), а панель потом перерисует W7 («From panel?» → «Panel job»).
//   ✅ / 🤔 / ❌ — записать решение, кнопки сменить на «↩️ Изменить» (keyboard = decided).
//     Решение расходится с нейросетью и причины ещё нет → ask: вопрос «почему?» ответом на карточку.
//     ✅ и письма ещё нет → need_letter: W5 напишет письмо (этап 4).
//   📨 Уже откликался (choice = earlier) — status = applied без письма; «почему?» не спрашиваем:
//     отклик был до бота, в теневой режим не идёт.
//   🚫 В ЧС (choice = ban, 07.10.2026) — ❌ с причиной «чёрный список» без «почему?»; ban = компания → «Ban company».
//   ↩️ Изменить (choice = edit) — вернуть кнопки выбора (keyboard = choose), решение не меняется.
//   Отсеянная фильтром (status = rejected, 08.10.2026) — решение с панели меню, карточки в ленте у неё нет:
//     ✅ / 🤔 / 📨 — new_card: W3 отправит карточку в ленту (на неё ответит «Почему?» и письмо), «Почему?» —
//     с причинами фильтра (по ответам правим фильтр); 🤖 На оценку (choice = score) — status = detailed,
//     score: W3 сразу запустит W2, карточку пришлёт он. Страница с hh («Rescue parse») закрыта — «🔒 закрыта».
//   keyboard: decided | choose | none (карточки нет или перерисовывать нечего).
//   Вакансия в очереди робота (apply_state ≠ '', этап 6) — решение не меняется, тост «сначала ⛔ под письмом».

// @include n8n/shared/card.js

const action = $('Route').first().json;
const row = $input.first().json;

const out = {
  id: row.id,
  my_decision: row.my_decision ?? '',
  // Причину не затираем: «Save choice» пишет её всегда
  my_reason: row.my_reason ?? '',
  status: row.status,
  keyboard: 'choose',
  ask: '',
  toast: '',
  need_letter: false,
  chatId: action.chatId,
  messageId: action.panel ? row.tg_message_id : action.messageId,
  queryId: action.queryId,
  panel: action.panel ?? null,
  ban: null,
  new_card: false,
  score: false,
};
// Страница, загруженная перед решением (только у отсеянных без описания)
let page = null;
try {
  page = $('Rescue parse').first().json;
} catch {
  // не загружали
}
const rescue = row.status === 'rejected' && action.choice !== 'edit';

// Робот (этап 6) уже взял вакансию в очередь или отправляет отклик — решение не меняем
if (row.apply_state) {
  out.keyboard = 'none';
  out.toast = '🚀 Робот в работе — сначала ⛔ под письмом';
  out.text = cardText(row);
  return [{ json: out }];
}

if (rescue && page?.closed) {
  out.status = 'archived';
  out.keyboard = 'none';
  out.toast = '🔒 Вакансия уже закрыта на hh';
} else if (rescue && action.choice === 'score') {
  out.status = 'detailed';
  out.keyboard = 'none';
  out.score = true;
  out.toast = '🤖 Отправил нейросети — карточка придёт в ленту';
} else if (action.choice === 'score') {
  out.keyboard = 'none'; // «На оценку» — только для отсеянных
} else if (rescue) {
  out.my_decision = action.choice;
  out.status = STATUS_BY_CHOICE[action.choice];
  out.keyboard = 'decided';
  out.toast = `Записал: ${CHOICE[action.choice]}`;
  out.need_letter = action.choice === 'apply' && !row.letter;
  out.new_card = !row.tg_message_id;
  if (action.choice !== 'earlier' && !row.my_reason) {
    out.ask =
      `🧹 Фильтр: ${esc(row.reasons || 'отсеял')} · 👤 ${CHOICE[action.choice]}\n` +
      'Почему? Ответь на это сообщение одной фразой — по ответам поправлю фильтр.';
  }
} else if (action.choice === 'ban') {
  out.my_decision = 'skip';
  out.my_reason = BAN_REASON;
  out.status = STATUS_BY_CHOICE.skip;
  out.keyboard = 'decided';
  out.toast = `🚫 ${row.company || 'Компания'} — в чёрном списке`;
  out.ban = { company: row.company ?? '', company_id: row.company_id ?? '', title: row.title ?? '' };
} else if (action.choice !== 'edit') {
  out.my_decision = action.choice;
  out.status = STATUS_BY_CHOICE[action.choice];
  out.keyboard = 'decided';
  out.toast = `Записал: ${CHOICE[action.choice]}`;
  out.need_letter = action.choice === 'apply' && !row.letter;
  const known = ['apply', 'maybe', 'skip'].includes(row.decision);
  if (action.choice !== 'earlier' && known && row.decision !== action.choice && !row.my_reason) {
    out.ask =
      `🤖 ${VERDICT[row.decision]} · 👤 ${CHOICE[action.choice]}\n` +
      'Почему? Ответь на это сообщение одной фразой — по ответам поправлю правила.';
  }
}
out.text = cardText({ ...row, ...(page ?? {}), my_decision: out.my_decision, my_reason: out.my_reason, status: out.status });

return [{ json: out }];
