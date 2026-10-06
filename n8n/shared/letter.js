// Общий код сообщения с письмом в Telegram: W5 «Format letter» и W3 «Apply sent».
// Подключается после n8n/shared/card.js (нужны esc и thaiDate):
//   // @include n8n/shared/card.js
//   // @include n8n/shared/letter.js

const LETTER_HEAD = { new: '✉️ Письмо', redo: '🔄 Новый вариант письма', revise: '✏️ Письмо с правкой' };

// r: строка вакансии + { ok, letter, problem, mode, instruction }. Письмо — в <pre>: копируется одним нажатием.
// После «📨 Отправил» (status = applied) подсказки заменяет строка «📨 Отклик отправлен …»
function letterText(r) {
  const head = `${LETTER_HEAD[r.mode] ?? LETTER_HEAD.new} · <a href="${r.url}">${esc(r.title)}</a> · ${esc(r.company)}`;
  if (!r.ok) {
    return [head, `⚠️ Письмо не получилось: ${esc(r.problem)}`, 'Нажми «🔄 Переписать», чтобы попробовать ещё раз.'].join('\n');
  }
  const sent = r.status === 'applied';
  const closed = r.status === 'archived';
  return [
    head,
    r.mode === 'revise' && r.instruction ? `<i>Пожелание: «${esc(r.instruction)}»</i>` : '',
    `<pre>${esc(r.letter)}</pre>`,
    !sent && !closed && r.has_test ? '📝 У вакансии тест — ответы в форме отклика на hh.' : '',
    sent
      ? `📨 Отклик отправлен${r.applied_at ? ` ${thaiDate(r.applied_at)}` : ''}`
      : closed
        ? '🔒 Вакансия закрыта на hh — отклик уже не отправить'
        : '<i>Нажми на письмо — скопируется. Поправить — ответь на это сообщение.</i>',
  ]
    .filter(Boolean)
    .join('\n');
}
