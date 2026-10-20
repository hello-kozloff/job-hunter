// W9 · Result — исход отклика робота → строка вакансии, письмо, карточка, скриншот, продолжать ли очередь.
// Нода: Code, режим «Run Once for All Items». Вход: «Apply» — ответ робота POST /apply (полный: statusCode, body;
// нет связи — { error }); «Gate» → next — вакансия, которую взяли («Claim»); «Job».
// Выход: { id, chatId, messageId, layout, text, url, apply_url, robot_button — вид письма для «View»;
//          row — что записать («Save result»); card — { messageId, text } или null; shot — скриншот при сбое;
//          sync — задание W7 (перерисовать панель); more — вызвать W9 снова (очередь не пуста); delay — через сколько
//          секунд (до паузы робота между откликами, 6.1c; дольше минуты — подхватит расписание) }
// Группы исходов (applier/src/hh/state.mjs → GROUP): done | manual | closed | block | error | dry; ответы HTTP:
//   409 (робот занят), 5xx, нет связи → retry — назад в очередь без счёта попыток; 423 (блок), 429 (потолок дня
//   робота) → block. Таймаут — тоже retry: если робот успел откликнуться, при повторе он увидит «уже откликались».
//   429 (6.1c): reason gap / hour — пауза между откликами или лимит часа (робот держит темп сам) → retry; day — потолок
//   дня → block. apply_at — когда робот закончил попытку (журнал 🤖 и сводка W6): у всех исходов, кроме retry.

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/robot.js
// @include n8n/shared/letter.js

const job = $('Job').first().json;
const row = $('Gate').first().json.next;
const res = $input.first()?.json ?? {};
const code = Number(res.statusCode) || 0;
const body = res.body && typeof res.body === 'object' ? res.body : {};
const now = new Date().toISOString();
// Неудачи подряд до этой попытки («Claim» уже прибавил 1 в таблице — засчитываем её только при error)
const triesBefore = Number(row.apply_tries) || 0;

let group = body.group;
let outcome = body.outcome;
if (res.error || !code) [group, outcome] = ['retry', 'unreachable'];
else if (code === 409) [group, outcome] = ['retry', 'busy'];
else if (code === 423) [group, outcome] = ['block', body.blocked?.kind ?? 'blocked'];
else if (code === 429) [group, outcome] = ['gap', 'hour'].includes(body.reason) ? ['retry', 'pace'] : ['block', 'cap'];
else if (code !== 200 || !group) [group, outcome] = ['error', 'error'];

const warnings = Array.isArray(body.warnings) ? body.warnings.filter(Boolean).join('; ') : '';
const update = { apply_state: '', apply_tries: triesBefore, apply_at: now };
let layout = 'robot';
let card = null;
let shot = '';
let more = true;

if (group === 'retry' || group === 'block') {
  // Назад в очередь: робот занят, не отвечает или ждёт человека (тревогу пришлёт «Gate» следующего тика)
  Object.assign(update, { apply_state: 'queued', apply_at: row.apply_at ?? '' });
  layout = 'wait';
  // Потолок дня робота — до завтра: без самовызова (иначе петля 429); пауза робота — тик, когда она кончится
  more = group === 'block' ? outcome !== 'cap' : outcome === 'pace';
} else if (group === 'done') {
  Object.assign(update, {
    status: 'applied',
    apply_result: outcome,
    apply_by: outcome === 'already' ? 'hh' : 'robot',
    apply_letter: outcome === 'already' ? '' : (body.letter ?? ''),
    apply_note: warnings.slice(0, 300),
    applied_at: row.applied_at || now,
    apply_tries: 0,
  });
  layout = 'done';
} else if (group === 'manual') {
  Object.assign(update, {
    apply_result: outcome,
    apply_note: String(body.note ?? '').slice(0, 300),
    ...(outcome === 'test' && { has_test: true }),
    ...(outcome === 'external' && { apply_type: 'external' }),
  });
  layout = 'manual';
} else if (group === 'closed') {
  Object.assign(update, { status: 'archived', apply_result: outcome, apply_tries: 0 });
  layout = 'none';
} else if (group === 'dry') {
  Object.assign(update, { apply_result: 'dry_run', apply_note: String(body.note ?? '').slice(0, 300) });
  shot = body.shot ?? '';
} else {
  // error: попытка засчитана («Claim» прибавил 1); с 3-й — только вручную
  const tries = triesBefore + 1;
  Object.assign(update, {
    apply_result: 'error',
    apply_note: String(body.note ?? `ответ робота ${code}`).slice(0, 300),
    apply_tries: tries,
  });
  layout = tries >= 3 ? 'manual' : 'robot';
  shot = body.shot ?? '';
  more = false;
}

const next = { ...row, ...update };
// Строка для записи: только колонки таблицы (Save result пишет их поимённо)
const rowOut = {
  status: next.status,
  apply_state: next.apply_state ?? '',
  apply_result: next.apply_result ?? '',
  apply_letter: next.apply_letter ?? '',
  apply_note: next.apply_note ?? '',
  apply_by: next.apply_by ?? '',
  applied_at: next.applied_at ?? '',
  apply_tries: Math.max(0, Number(next.apply_tries) || 0),
  has_test: Boolean(next.has_test),
  apply_type: next.apply_type ?? 'hh',
  apply_at: next.apply_at ?? '',
};
if (group === 'done' || group === 'closed') card = { messageId: row.tg_message_id, text: cardText(next) };
// Темп (6.1c): робот сказал, когда можно следующий; больше минуты — ждём расписания, а не держим запуск
// Автоотклик (6.1c): письма в чате нет — ни правки письма, ни скриншота ответом на него; исход — в журнале панели 🤖
if (!row.tg_letter_id) {
  layout = '';
  shot = '';
}
const paceAt = Date.parse(body.pace?.nextAt ?? body.retryAt ?? '') || 0;
const delay = Math.max(0, Math.ceil((paceAt - Date.now()) / 1000));
if (delay > 60) more = false;

return [
  {
    json: {
      id: row.id,
      chatId: job.chatId,
      messageId: row.tg_letter_id,
      layout,
      url: row.url,
      apply_url: row.apply_url,
      // Сбой — письмо снова с 🚀: при нескольких резюме подпись называет резюме
      robot_button: robotButtonText(row),
      text: letterText({
        ...next,
        ok: Boolean(row.letter),
        mode: 'new',
        robot_wait: group === 'block' ? 'проверки — сейчас напишу, чего именно' : group === 'retry' ? 'своей очереди' : '',
      }),
      group,
      outcome,
      row: rowOut,
      card,
      shot,
      caption: shot ? `${group === 'dry' ? '🧪' : '⚠️'} ${esc(row.title)} · ${esc(String(body.note ?? outcome)).slice(0, 200)}` : '',
      sync: { action: 'panel', view: 'sync', id: row.id, chatId: job.chatId, tab: '', page: 1, queryId: '', messageId: 0, userMessageId: 0 },
      more,
      delay: more ? delay : 0,
    },
  },
];
