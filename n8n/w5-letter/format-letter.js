// W5 · Format letter — сообщение с письмом для Telegram (Parse Mode = HTML), ответом на карточку.
// Нода: Code, режим «Run Once for All Items».
// Вход: «Parse letter»; задание — из «Jobs», вакансия — из «Vacancy».
// Выход: { id, ok, text, replyTo, apply_url, url } → «Send letter» с кнопками
//   [📝 Отклик] [🔗 Вакансия] / [🔄 Переписать] [📨 Отправил].
// Письмо — в блоке <pre>: в Telegram он копируется одним нажатием.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jobs = new Map($('Jobs').all().map((i) => [i.json.id, i.json]));
const rows = new Map($('Vacancy').all().map((i) => [i.json.id, i.json]));
const HEAD = { new: '✉️ Письмо', redo: '🔄 Новый вариант письма', revise: '✏️ Письмо с правкой' };

return $input.all().map((item) => {
  const r = item.json;
  const job = jobs.get(r.id) ?? {};
  const row = rows.get(r.id) ?? {};
  const title = `${HEAD[r.mode] ?? HEAD.new} · <a href="${row.url}">${esc(row.title)}</a> · ${esc(row.company)}`;
  const lines = r.ok
    ? [
        title,
        r.mode === 'revise' && job.instruction ? `<i>Пожелание: «${esc(job.instruction)}»</i>` : '',
        `<pre>${esc(r.letter)}</pre>`,
        row.has_test ? '📝 У вакансии тест — ответы в форме отклика на hh.' : '',
        '<i>Нажми на письмо — скопируется. Поправить — ответь на это сообщение.</i>',
      ]
    : [title, `⚠️ Письмо не получилось: ${esc(r.problem)}`, 'Нажми «🔄 Переписать», чтобы попробовать ещё раз.'];
  return {
    json: {
      id: r.id,
      ok: r.ok,
      mode: r.mode,
      letter: r.letter ?? '',
      instruction: job.instruction ?? '',
      text: lines.filter(Boolean).join('\n'),
      replyTo: row.tg_message_id,
      apply_url: row.apply_url,
      url: row.url,
      letter_notes: row.letter_notes ?? '',
    },
  };
});
