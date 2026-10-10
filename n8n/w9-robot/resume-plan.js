// W9 · Resume plan — ▶️ или /go после блока: робот перепроверил вход и капчу (POST /resume).
// Нода: Code, режим «Run Once for All Items». Вход: ответ робота (полный: statusCode, body { ok, loggedIn, blocked })
// или { error }; «Job» — queryId (▶️ — ответить всплывашкой) или его нет (/go — ответить сообщением).
// Выход: { ok, toast, reply } — дальше в любом случае тик очереди: «Gate» поправит тревогу, если блок снят

const job = $('Job').first().json;
const res = $input.first()?.json ?? {};
const body = res.body && typeof res.body === 'object' ? res.body : {};
const WAIT = { login: 'робот всё ещё не вошёл в hh', captcha: 'капча ещё на экране', smart: 'капча ещё на экране', limit: 'лимит hh ещё не прошёл' };
let toast;
if (res.error || Number(res.statusCode) !== 200) toast = '⚠️ Робот не отвечает — scripts/deploy.sh --applier';
else if (body.blocked) toast = `⏸ Пока нет: ${WAIT[body.blocked.kind] ?? body.blocked.kind}`;
else toast = '▶️ Робот снова в работе';
return [{ json: { ok: !body.blocked && !res.error, toast, reply: job.queryId ? '' : toast } }];
