// Общий код сообщения с письмом в Telegram: W5 «Format letter», W3 «Apply sent», W9 Robot.
// Подключается после n8n/shared/card.js (нужны esc и thaiDate) и n8n/shared/robot.js (строка робота):
//   // @include n8n/shared/card.js
//   // @include n8n/shared/robot.js
//   // @include n8n/shared/letter.js

const LETTER_HEAD = { new: '✉️ Письмо', redo: '🔄 Новый вариант письма', revise: '✏️ Письмо с правкой' };

// r: строка вакансии + { ok, letter, problem, mode, instruction }. Письмо — в <pre>: копируется одним нажатием.
// После «📨 Отправил» (status = applied) подсказки заменяет строка «📨 Отклик отправлен …».
// Робот (этап 6): строку очереди и итога даёт robotLine из n8n/shared/robot.js (подключается перед этим файлом)
function letterText(r) {
  const head = `${LETTER_HEAD[r.mode] ?? LETTER_HEAD.new} · <a href="${r.url}">${esc(r.title)}</a> · ${esc(r.company)}`;
  if (!r.ok) {
    return [head, `⚠️ Письмо не получилось: ${esc(r.problem)}`, 'Нажми «🔄 Переписать», чтобы попробовать ещё раз.'].join('\n');
  }
  const sent = r.status === 'applied';
  const closed = r.status === 'archived';
  const robot = typeof robotLine === 'function' ? robotLine(r) : '';
  return [
    head,
    r.mode === 'revise' && r.instruction ? `<i>Пожелание: «${esc(r.instruction)}»</i>` : '',
    `<pre>${esc(r.letter)}</pre>`,
    !sent && !closed && r.has_test && r.apply_result !== 'test' ? '📝 У вакансии тест — ответы в форме отклика на hh.' : '',
    sent
      ? robot || `📨 Отклик отправлен${r.applied_at ? ` ${thaiDate(r.applied_at)}` : ''}`
      : closed
        ? '🔒 Вакансия закрыта на hh — отклик уже не отправить'
        : robot || '<i>Нажми на письмо — скопируется. Поправить — ответь на это сообщение.</i>',
  ]
    .filter(Boolean)
    .join('\n');
}
