// W13 · Job — что пришло из W3 «Route» (15.10.2026, docs/recommendations.md): кнопка rs: | ru: | rq: | rp: | rr:
// (data — callback_data как есть) или ответ на вопрос RESUME_PROMPTS (op input, field, text). Ручной запуск — панель.
// Нода: Code, режим «Run Once for All Items».
// Выход: { op, sid, index, value, field, text, chatId, queryId, messageId, userMessageId, promptId }
//   rs:view → view · rs:up → upgrade · rs:file → file · rs:undo → undo (rs:undo:y — откатить)
//   Несколько резюме (docs/resumes.md): rs:list → targets (выбор резюме) · rs:r:<id> → target (value id: работаем с ним)
//   ru:<sid>:<y|e|n> → plan: верно | не так | отмена
//   rq:<sid>:go → start · rq:<sid>:x → stop · rq:<sid>:<вопрос>:<0-7|t|k|d> → answer: вариант | свой ответ | пропустить | готово
//   rp:<sid>:<правка>:<y|r|a|e|n> → patch: применить | заменить | дописать | иначе | не надо
//   rr:<sid> → retry — повторить запрос к нейросети
//   Разделы резюме (часть D): rc:go[:n] → split (value n — без hh) · rc:<sid>:<hh|nohh|x> → splitctl ·
//   rc:<sid>:<n>:<b|h|a|k> → field: как в боте | с hh | добавить место | пропустить · rk:view → skills ·
//   rk:<sid>:<i> → pick · rk:<sid>:p<стр> → page · rk:<sid>:<d|x> → pickdone | pickstop · rx:<view|up> → exp
//   Выгрузка на hh: re:go → export · re:<sid>:<n>:<p|k|h> → item: на hh | не трогать | взять с hh ·
//   re:<sid>:<dry|live|x> → write: сухой прогон | записать | отмена

const j = $input.first().json;
const out = {
  op: j.op ?? 'view',
  sid: '',
  index: -1,
  value: String(j.value ?? ''),
  field: String(j.field ?? ''),
  text: String(j.text ?? ''),
  chatId: String(j.chatId || $env.TG_CHAT_ID),
  queryId: String(j.queryId ?? ''),
  messageId: Number(j.messageId) || 0,
  userMessageId: Number(j.userMessageId) || 0,
  promptId: Number(j.promptId) || 0,
};
const data = String(j.data ?? '');
let m;
if ((m = data.match(/^rs:(view|an|up|file|undo)(?::(y))?$/))) {
  out.op = { view: 'view', an: 'analyze', up: 'upgrade', file: 'file', undo: 'undo' }[m[1]];
  out.value = m[2] ?? '';
} else if (data === 'rs:list') {
  out.op = 'targets';
} else if ((m = data.match(/^rs:r:(r[1-5])$/))) {
  Object.assign(out, { op: 'target', value: m[1] });
} else if ((m = data.match(/^ru:([a-z0-9]{4}):([yen])$/))) {
  Object.assign(out, { op: 'plan', sid: m[1], value: m[2] });
} else if ((m = data.match(/^rq:([a-z0-9]{4}):(go|x)$/))) {
  Object.assign(out, { op: m[2] === 'go' ? 'start' : 'stop', sid: m[1] });
} else if ((m = data.match(/^rq:([a-z0-9]{4}):(\d):([0-7tkd])$/))) {
  Object.assign(out, { op: 'answer', sid: m[1], index: Number(m[2]), value: m[3] });
} else if ((m = data.match(/^rp:([a-z0-9]{4}):(\d):([yraen])$/))) {
  Object.assign(out, { op: 'patch', sid: m[1], index: Number(m[2]), value: m[3] });
} else if ((m = data.match(/^rr:([a-z0-9]{4})$/))) {
  Object.assign(out, { op: 'retry', sid: m[1] });
} else if ((m = data.match(/^rc:go(?::(n))?$/))) {
  Object.assign(out, { op: 'split', value: m[1] ?? '' });
} else if ((m = data.match(/^rc:([a-z0-9]{4}):(hh|nohh|x)$/))) {
  Object.assign(out, { op: 'splitctl', sid: m[1], value: m[2] });
} else if ((m = data.match(/^rc:([a-z0-9]{4}):(\d{1,2}):([bhak])$/))) {
  Object.assign(out, { op: 'field', sid: m[1], index: Number(m[2]), value: m[3] });
} else if (data === 'rk:view') {
  out.op = 'skills';
} else if ((m = data.match(/^rk:([a-z0-9]{4}):(\d{1,2})$/))) {
  Object.assign(out, { op: 'pick', sid: m[1], index: Number(m[2]) });
} else if ((m = data.match(/^rk:([a-z0-9]{4}):p(\d)$/))) {
  Object.assign(out, { op: 'page', sid: m[1], index: Number(m[2]) });
} else if ((m = data.match(/^rk:([a-z0-9]{4}):([dx])$/))) {
  Object.assign(out, { op: m[2] === 'd' ? 'pickdone' : 'pickstop', sid: m[1] });
} else if ((m = data.match(/^rx:(view|up)$/))) {
  Object.assign(out, { op: 'exp', value: m[1] });
} else if (data === 're:go') {
  out.op = 'export';
} else if ((m = data.match(/^re:([a-z0-9]{4}):(\d{1,2}):([pkh])$/))) {
  Object.assign(out, { op: 'item', sid: m[1], index: Number(m[2]), value: m[3] });
} else if ((m = data.match(/^re:([a-z0-9]{4}):(dry|live|x)$/))) {
  Object.assign(out, { op: 'write', sid: m[1], value: m[2] });
} else if (data) {
  out.op = 'view';
}
return [{ json: out }];
