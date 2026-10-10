// W9 · Captcha plan — ответ пользователя на фото капчи ушёл роботу (POST /captcha): что дальше.
// Нода: Code, режим «Run Once for All Items». Вход: ответ робота (полный: statusCode, body { ok, kind, shot }) или
// { error }; «Job» — promptId (фото капчи), userMessageId (ответ пользователя).
// Выход: { solved, deleteIds, notice, text }
//   solved — капча принята: фото и ответ удалить, «✅ Капча принята» (с кнопками меню — ForceReply их спрятал), дальше
//   очередь; не подошла — новое фото капчи (notice → те же ноды, что у «Gate»).

// @include n8n/shared/card.js
// @include n8n/shared/robot.js
// @include n8n/shared/menu.js

const job = $('Job').first().json;
const res = $input.first()?.json ?? {};
const body = res.body && typeof res.body === 'object' ? res.body : {};
const solved = Number(res.statusCode) === 200 && body.ok === true;
const out = { solved, deleteIds: [job.promptId, job.userMessageId].filter(Boolean), notice: null, text: '' };
if (solved) {
  out.text = '✅ Капча принята — продолжаю';
} else if (body.shot) {
  out.notice = {
    kind: 'captcha',
    shot: body.shot,
    text: `${ROBOT_PROMPTS.captcha} — не подошло, вот новая. Ответьте на это фото текстом с картинки.\nНе читается — решите в окне робота (${VNC_URL}) и пришлите /go`,
    silent: false,
  };
} else {
  out.text = `⚠️ Капча: ${esc(body.error ?? res.error?.message ?? 'робот не ответил')}. Решите в окне робота (${VNC_URL}) и пришлите /go`;
}
return [{ json: out }];
