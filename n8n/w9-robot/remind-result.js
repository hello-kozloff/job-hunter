// W9 · Remind result — исход напоминания робота (6.3) → строка вакансии, перерисовка панели, продолжать ли очередь.
// Нода: Code, режим «Run Once for All Items». Вход: «Remind» — ответ робота POST /remind (полный: statusCode, body;
// нет связи — { error }); «Gate» → remind — строка, которую взяли («Remind claim»); «Job».
// Выход: { id, row — что записать («Save remind»), group, outcome, sync — задание W7, more — вызвать W9 снова, delay }
// Группы (applier/src/hh/state.mjs → REMIND_GROUP): done | skip | later | dry | block | error; ответы HTTP: 409 (робот
// занят), 5xx, нет связи → retry — назад в очередь; 423 (блок) → block; 429: gap / remind_hour — пауза робота → retry,
// remind_day — потолок дня робота → block (до завтра, без самовызова); 400 — неверный запрос → error.
// remind_at — когда робот закончил попытку (журнал 🔔, лимит дня, сводка W6): у всех исходов, кроме retry и block

const job = $('Job').first().json;
const row = $('Gate').first().json.remind;
const res = $input.first()?.json ?? {};
const code = Number(res.statusCode) || 0;
const body = res.body && typeof res.body === 'object' ? res.body : {};
const now = new Date().toISOString();

let group = body.group;
let outcome = body.outcome;
if (res.error || !code) [group, outcome] = ['retry', 'unreachable'];
else if (code === 409) [group, outcome] = ['retry', 'busy'];
else if (code === 423) [group, outcome] = ['block', body.blocked?.kind ?? 'blocked'];
else if (code === 429) [group, outcome] = ['gap', 'remind_hour'].includes(body.reason) ? ['retry', 'pace'] : ['block', 'cap'];
else if (code !== 200 || !group) [group, outcome] = ['error', 'error'];

const note = String(body.note ?? body.error ?? (group === 'error' && code !== 200 ? `ответ робота ${code || 'нет'}` : '')).slice(0, 300);
let more = true;
let update;
if (group === 'retry' || group === 'block') {
  // Назад в очередь: робот занят, не отвечает или ждёт человека (тревогу пришлёт «Gate» следующего тика)
  update = { remind_state: 'queued', remind_result: row.remind_result ?? '', remind_at: row.remind_at ?? '', remind_note: row.remind_note ?? '' };
  more = group === 'block' ? outcome !== 'cap' : outcome === 'pace';
} else {
  update = { remind_state: '', remind_result: outcome, remind_at: now, remind_note: note };
  // Сбой — следующий по расписанию: три подряд робот сам остановит блоком
  if (group === 'error') more = false;
}
const rowOut = { ...update, hh_chat_id: String(body.chatId || row.hh_chat_id || '') };
const paceAt = Date.parse(body.pace?.nextAt ?? body.retryAt ?? '') || 0;
const delay = Math.max(0, Math.ceil((paceAt - Date.now()) / 1000));
if (delay > 60) more = false;

return [
  {
    json: {
      id: row.id,
      group,
      outcome,
      row: rowOut,
      sync: { action: 'panel', view: 'sync', id: row.id, chatId: job.chatId, tab: '', page: 1, queryId: '', messageId: 0, userMessageId: 0 },
      more,
      delay: more ? delay : 0,
    },
  },
];
