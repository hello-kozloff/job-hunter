// W13 · Written — ответ робота на запись резюме hh (POST /resume/write, часть D E2/E3; docs/recommendations.md →
// «Выгрузка на hh»). Нода: Code, режим «Run Once for All Items». Вход: «Write hh» (HTTP Request, полный ответ без
// исключений; нет связи — item { error }), static data (сессия export).
// Выход: { error } — '' или причина; итог (results — по разделу: dry | saved | same | error, after — резюме hh после
// живой записи) — в сессию для «Step».

const r = $input.first().json;
const state = $getWorkflowStaticData('global');
const sess = state.session;
const status = Number(r.statusCode) || 0;
const body = r.body ?? null;
let error = '';
if (!status) error = 'down';
else if (status === 409) error = 'busy';
else if (status === 423) error = `blocked:${body?.blocked?.kind ?? ''}`;
else if (status !== 200) error = String(body?.error ?? `http:${status}`);
else if (!body?.ok) error = String(body?.error ?? 'layout');
if (sess?.kind === 'export') {
  sess.writeError = error;
  sess.results = error ? null : body.results;
  sess.after = error ? null : body.after ?? null;
  sess.wroteLive = !error && Boolean(body.live);
}
return [{ json: { error } }];
