// W2 · Release — вернуть в detailed захваченные строки, по которым карточка не ушла (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Своя ветка от триггера, самая нижняя: выполняется последней.
// «Claim» перевёл строки detailed → scoring, чтобы второй запуск W2 не взял их же. Карточка ушла → «Save cards»
// поставил waiting; не ушла (лимит нейросети, сетевая ошибка, Telegram не принял) → строку надо вернуть,
// иначе она застрянет в scoring (такие W6 всё равно вернёт через 30 мин).
// Выход: [{ id }] → «Save release» (status = detailed).

const all = (name) => {
  try {
    return $(name)
      .all()
      .map((i) => i.json);
  } catch {
    return []; // нода в этом запуске не выполнялась
  }
};
// Карточка ушла или skip закрыт без карточки (теневой режим выключен)
const carded = new Set([...all('Card sent'), ...all('Quiet skips'), ...all('First save')].map((r) => r.id));
return all('Claim')
  .map((r) => r.id)
  .filter((id) => id && !carded.has(id))
  .map((id) => ({ json: { id } }));
