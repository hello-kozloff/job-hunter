// W9 · Done — итог 🚀 / ⛔ после записи с условием («Enqueue» / «Unqueue»).
// Нода: Code, режим «Run Once for All Items». Вход: строка, которую обновила запись (пустой item — не обновила:
// двойное нажатие или робот успел взять вакансию), «Plan» — что собирались сделать.
// Выход: план с поправкой; tick — сразу обработать очередь (🚀 записан)

const plan = $('Plan').first().json;
const updated = Boolean($input.first()?.json?.id);
if (plan.save && !updated) {
  return [
    {
      json: {
        ...plan,
        ok: false,
        layout: '',
        tick: false,
        toast: plan.save === 'enqueue' ? '⏳ Уже в очереди робота' : '🤖 Уже отправляется — отменить нельзя',
      },
    },
  ];
}
return [{ json: { ...plan, tick: plan.save === 'enqueue' } }];
