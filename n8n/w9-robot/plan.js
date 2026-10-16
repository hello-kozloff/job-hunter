// W9 · Plan — 🚀 или ⛔ под письмом: можно ли, куда перевести очередь, что ответить и как перерисовать письмо.
// Нода: Code, режим «Run Once for All Items». Вход: «Row» — строка вакансии (пустой item — строки нет);
// «Job» — нажатие; «Settings» — настройки бота.
// Выход: { id, op, ok, save, toast, layout, chatId, messageId, queryId, text, url, apply_url }
//   save: enqueue — '' → queued (✅, письмо есть, нет теста, робот включён); stop — queued → ''; '' — ничего не пишем.
//   Запись — Update с условием («Enqueue» / «Unqueue»): двойное нажатие или робот, успевший взять вакансию, ничего
//   не сломают — «Done» это увидит. layout — вид письма: wait (⏳ + ⛔) | robot (с 🚀) | manual (без 🚀) | '' — не трогать.

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/settings.js
// @include n8n/shared/resumes.js
// @include n8n/shared/robot.js
// @include n8n/shared/letter.js

const job = $('Job').first().json;
const row = $input.first()?.json ?? {};
const s = loadSettings($('Settings').all());
const out = {
  id: row.id ?? job.id,
  op: job.op,
  ok: false,
  save: '',
  toast: '',
  layout: '',
  chatId: job.chatId,
  // Правим всегда само письмо: 🚀 могли нажать и на фото «не смог» ([🚀 Ещё раз])
  messageId: row.tg_letter_id || job.messageId || 0,
  queryId: job.queryId,
  url: row.url ?? '',
  apply_url: row.apply_url ?? '',
};
let view = { ...row };

if (!row.id) {
  out.toast = 'Вакансии нет в таблице';
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
    view = { ...row, apply_state: 'queued', apply_result: '', apply_note: '' };
  }
} else if (row.apply_state === 'queued') {
  out.ok = true;
  out.save = 'unqueue';
  out.toast = '⛔ Убрал из очереди робота';
  view = { ...row, apply_state: '' };
  out.layout = robotEligible(view, s['apply.enabled']) ? 'robot' : 'manual';
} else if (row.apply_state === 'applying') {
  out.toast = '🤖 Уже отправляется — отменить нельзя';
} else {
  out.toast = 'Вакансия не в очереди';
  out.layout = robotEligible(row, s['apply.enabled']) ? 'robot' : 'manual';
}

out.text = row.id ? letterText({ ...view, ok: Boolean(row.letter), mode: 'new' }) : '';
return [{ json: out }];
