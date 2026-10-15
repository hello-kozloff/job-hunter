// W13 · Hh — ответ робота на «прочитать резюме hh» (часть D, docs/recommendations.md → «Разделы резюме»).
// Нода: Code, режим «Run Once for All Items». Вход: «Read hh» (HTTP Request к роботу, полный ответ без исключений;
// нет связи или нет credential — item { error }), static data (сессия split).
// Выход: { next: llm | step, error } — llm: раскладка нейросетью (с резюме hh или, если робота нет, без него);
//   step — показать причину с кнопками «🔄 Повторить» / «➡️ Без hh». Резюме hh — в сессию (sess.hh).
//   Выгрузка на hh (сессия export) — всегда step: «Step» сравнит бота с hh; live — включена ли запись (RESUME_LIVE).

const r = $input.first().json;
const state = $getWorkflowStaticData('global');
const sess = state.session;
const result = (next, error = '') => [{ json: { next, error } }];
const exporting = sess?.kind === 'export' && !sess.hh;
if (!sess || (!exporting && (sess.kind !== 'split' || sess.cv))) return result('step', 'stale');

const status = Number(r.statusCode) || 0;
const body = r.body ?? null;
let error = '';
if (!status) error = 'down';
else if (status === 409) error = 'busy';
else if (status === 423) error = `blocked:${body?.blocked?.kind ?? ''}`;
else if (status !== 200) error = `http:${status}`;
else if (!body?.ok || !body.resume) error = String(body?.error ?? 'layout');

if (!error) {
  sess.hh = body.resume;
  sess.hhError = '';
  if (exporting) {
    sess.live = Boolean(body.resumeLive);
    return result('step');
  }
  return result('llm');
}
sess.hhError = error;
if (exporting) return result('step', error);
// Робота нет или он не отвечает — раскладываем без hh: у человека без робота это обычный путь
return error === 'down' ? result('llm', error) : result('step', error);
