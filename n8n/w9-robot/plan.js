// W9 · Plan — 🚀 или ⛔ под письмом: можно ли, куда перевести очередь, что ответить и как перерисовать письмо.
// Нода: Code, режим «Run Once for All Items». Вход: «Row» — строка вакансии (пустой item — строки нет);
// «Job» — нажатие; «Settings» — настройки бота.
// Выход: { id, op, ok, save, mode, tries, toast, layout, chatId, messageId, queryId, text, url, apply_url, robot_button }
//   save: enqueue — '' → queued (✅, письмо есть, нет теста, робот включён); stop — queued → '' (apply_result = stopped:
//   автоотклик её больше не возьмёт); '' — ничего не пишем.
//   Автоотклик (6.1c, job.auto — W5 после письма, «Feed» W9): не нажатие — без тоста; только пока автоотклик включён,
//   не после ⛔ (stopped); mode = auto → apply_mode, tries = 0 (попытки письма не в счёт сбоев робота). 🚀 — mode = ''.
//   Запись — Update с условием («Enqueue» / «Unqueue»): двойное нажатие или робот, успевший взять вакансию, ничего
//   не сломают — «Done» это увидит. layout — вид письма: wait (⏳ + ⛔) | robot (с 🚀) | manual (без 🚀) | '' — не трогать.

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/settings.js
// @include n8n/shared/resumes.js
// @include n8n/shared/robot.js
// @include n8n/shared/auto.js
// @include n8n/shared/letter.js

const job = $('Job').first().json;
const row = $input.first()?.json ?? {};
const s = loadSettings($('Settings').all());
const out = {
  id: row.id ?? job.id,
  op: job.op,
  ok: false,
  save: '',
  mode: job.auto ? 'auto' : '',
  tries: job.auto ? 0 : Number(row.apply_tries) || 0,
  toast: '',
  layout: '',
  chatId: job.chatId,
  // Правим всегда само письмо: 🚀 могли нажать и на фото «не смог» ([🚀 Ещё раз])
  messageId: row.tg_letter_id || job.messageId || 0,
  queryId: job.queryId,
  url: row.url ?? '',
  apply_url: row.apply_url ?? '',
  // Подпись 🚀, если письмо вернётся с ним (⛔): при нескольких резюме — каким резюме откликнется робот
  robot_button: robotButtonText(row),
};
let view = { ...row };

if (!row.id) {
  out.toast = 'Вакансии нет в таблице';
} else if (job.op === 'enqueue' && job.auto) {
  // Автоотклик: письмо осталось как есть (с 🚀), если вакансия ему уже не подходит — выключили, ⛔, ❌, тест
  if (autoOn(s) && !s['apply.paused'] && !row.apply_state && row.status === 'approved' && row.apply_result !== 'stopped' && robotEligible(row) && robotResume(s, row).ok) {
    out.ok = true;
    out.save = 'enqueue';
    out.layout = 'wait';
    view = { ...row, apply_state: 'queued', apply_mode: 'auto', apply_result: '', apply_note: '' };
  }
} else if (job.op === 'enqueue') {
  if (row.apply_state) {
    out.toast = '⏳ Уже в очереди робота';
  } else if (row.status === 'applied') {
    out.toast = '📨 Отклик уже отправлен';
  } else if (row.status !== 'approved') {
    out.toast = 'Робот откликается только на ✅';
  } else if (!s['apply.enabled']) {
    out.toast = '⏸ Робот выключен: ⚙️ → 🚀 Робот';
    out.layout = 'manual';
    view = { ...row, apply_result: 'disabled' };
  } else if (!robotEligible(row)) {
    out.toast = row.has_test ? '🧩 У вакансии тест — откликнитесь сами' : 'Робот не может откликнуться на эту вакансию';
    out.layout = 'manual';
  } else if (!robotResume(s, row).ok) {
    // Несколько резюме: резюме вакансии не связано с резюме на hh — робот откликнулся бы не тем
    out.toast = '📄 Резюме не связано с hh — откликнитесь сами';
    out.layout = 'manual';
    view = { ...row, apply_result: 'no_resume', apply_note: robotResume(s, row).reason };
  } else {
    out.ok = true;
    out.save = 'enqueue';
    out.toast = s['apply.paused'] ? '⏸ В очереди: робот на паузе (⚙️ → 🚀 Робот)' : '🚀 Робот откликается…';
    out.layout = 'wait';
    view = { ...row, apply_state: 'queued', apply_mode: '', apply_result: '', apply_note: '' };
  }
} else if (row.apply_state === 'queued') {
  out.ok = true;
  out.save = 'unqueue';
  out.toast = '⛔ Убрал из очереди робота';
  view = { ...row, apply_state: '', apply_result: 'stopped' };
  out.layout = robotEligible(view, s['apply.enabled']) ? 'robot' : 'manual';
} else if (row.apply_state === 'applying') {
  out.toast = '🤖 Уже отправляется — отменить нельзя';
} else {
  out.toast = 'Вакансия не в очереди';
  out.layout = robotEligible(row, s['apply.enabled']) ? 'robot' : 'manual';
}

out.text = row.id ? letterText({ ...view, ok: Boolean(row.letter), mode: 'new' }) : '';
return [{ json: out }];
