// W5 · Old letters — что удалить, когда новое письмо отправлено и записано: в ленте остаётся только актуальное
// (решение пользователя 07.10.2026).
// Нода: Code, режим «Run Once for All Items». Выполняется после «Save letter» — только если письма ушли:
// новое письмо не получилось → «Letter sent» пуст → старое остаётся.
// Вход: «Letter sent» — новые письма { id, tg_letter_id }; «Vacancy» — строки до записи (прошлый tg_letter_id);
//       «Jobs» — replace из W3: сообщение, где нажали «🔄», или письмо и ответ с пожеланием.
// Выход: item на сообщение { messageId } → «Delete old letter» (onError = continue: старше 48 ч Telegram
// удалять не даёт — это не ошибка).

const rows = new Map($('Vacancy').all().map((i) => [i.json.id, i.json]));
const jobs = new Map($('Jobs').all().map((i) => [i.json.id, i.json]));

return $('Letter sent')
  .all()
  .flatMap(({ json: sent }) => {
    const ids = new Set([rows.get(sent.id)?.tg_letter_id, ...(jobs.get(sent.id)?.replace ?? [])].map(Number));
    ids.delete(Number(sent.tg_letter_id));
    ids.delete(0);
    ids.delete(NaN);
    return [...ids].map((messageId) => ({ json: { messageId } }));
  });
