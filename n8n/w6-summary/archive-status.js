// W6 · Archive status — какие вакансии из хвостов закрылись на hh.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы «Vacancy page» по порядку списка check из «Plan».
// Закрыта: страница отдаёт 404/410 (вакансию удалили) или в ней status.archived / closedForApplicants.
// Не ответила, капча и т. п. — не трогаем, проверим завтра.
// Выход: только закрытые { id, tg_message_id, tg_letter_id, cardText, letterText } → карточка и письмо без кнопок.

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/letter.js
// @include n8n/shared/hh.js

const candidates = $('Plan').first().json.check;
const responses = $input.all().map((i) => i.json);

return candidates.flatMap((r, i) => {
  const res = responses[i] ?? {};
  let closed = res.statusCode === 404 || res.statusCode === 410;
  if (!closed && res.statusCode === 200) {
    const page = parsePage(res);
    closed = Boolean(page.v && (page.v.status?.archived || page.v.closedForApplicants));
  }
  if (!closed) return [];
  const updated = { ...r, status: 'archived' };
  return [
    {
      json: {
        id: r.id,
        tg_message_id: r.tg_message_id,
        tg_letter_id: r.tg_letter_id || null,
        cardText: cardText(updated),
        letterText: r.letter ? letterText({ ...updated, ok: true, mode: 'new' }) : '',
      },
    },
  ];
});
