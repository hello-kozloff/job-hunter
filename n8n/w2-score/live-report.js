// W2 · Live report — сообщение о сборе в чате одно: когда пришло новое, прошлое удаляется
// (решение пользователя 07.10.2026).
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы «Send summary» — по одному на сообщение «Summary», в том же порядке.
// Static data: liveId — живое сообщение «🔎 Сбор» в чате. Итог «📊 Оценено» с блоком сбора сверху живым не считается
//   (остаётся вместе с карточками), но прошлое живое сообщение после него тоже удаляется — оно устарело.
// Выход: [{ messageId }] → «Delete report» или [] — удалять нечего.
// Сначала отправка, потом удаление: клавиатура меню едет с новым сообщением. Новое не отправилось — прошлое не трогаем.

const state = $getWorkflowStaticData('global');
const messages = $('Summary')
  .all()
  .map((i) => i.json);
const index = messages.findIndex((m) => m.report);
if (index < 0) return []; // ручной запуск W2 — сбора не было

const id = $input.all()[index]?.json?.result?.message_id;
if (!id) return [];

const old = state.liveId;
state.liveId = messages[index].live ? id : null;
return old && old !== id ? [{ json: { messageId: old } }] : [];
