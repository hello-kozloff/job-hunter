// W9 · Gate — очередь робота: починка, можно ли сейчас отправлять, кого следующим, о чём сообщить.
// Нода: Code, режим «Run Once for All Items». Вход: «Queue» — строки в очереди (apply_state ≠ ''), «Today» — живые
// отклики робота за двое суток («день» с 09:00 по местному считает robotToday), «Health» — GET /health робота (ошибка — не отвечает), «Job», «Settings».
// Static data (global): alertedSince — блок, о котором уже сообщили (одна тревога на блок, по since);
//   alertMessageId — та тревога (снят блок → «✅ снова в работе»); downDay, limitDay — сообщения «не отвечает» и
//   «лимит» — раз в «день» робота.
// Выход: { heal[], next, wait, notice, resolved, views[] }
//   heal — починка: applying дольше 6 мин (n8n или робот упали посреди отклика) → queued; в очереди, но решение
//          сменили (не ✅) → снять. Повтор безопасен: робот перед кликом проверяет «уже откликались» на hh;
//   next — кого отправлять (старейшая queued); null — нельзя: wait = disabled | paused | down | blocked | busy | limit;
//   notice — сообщение: { kind: captcha | alert | info, key, text, shot, silent, button }; key — для POST /notice
//            робота: параллельные запуски W9 видят один блок, а отправит тревогу только первый;
//   resolved — блок снят: { messageId, text, promptId } — поправить прошлую тревогу и удалить фото капчи;
//   views — письма, которые перерисовать (нажали 🚀, а робот ждёт: «⏸ Робот ждёт: …»).

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/settings.js
// @include n8n/shared/robot.js
// @include n8n/shared/letter.js
// @include n8n/shared/menu.js

const job = $('Job').first().json;
const s = loadSettings($('Settings').all());
const queue = $('Queue')
  .all()
  .map((i) => i.json)
  .filter((r) => r.id);
const now = Date.now();
const today = robotToday(
  $('Today')
    .all()
    .map((i) => i.json)
    .filter((r) => r.id),
  now,
);
const h = $('Health').first()?.json ?? {};
const health = h.ok && !h.error ? h : null;
const state = $getWorkflowStaticData('global');
const dayKey = new Date(robotDayStart(now)).toISOString().slice(0, 10);
const limit = s['apply.daily_limit'];
const out = { heal: [], next: null, wait: '', notice: null, resolved: null, views: [] };

// 1. Починка
for (const r of queue) {
  if (r.status !== 'approved') out.heal.push({ id: r.id, to: '' });
  else if (r.apply_state === 'applying' && now - Date.parse(r.updatedAt) > 6 * 60 * 1000) out.heal.push({ id: r.id, to: 'queued' });
}
const healed = new Map(out.heal.map((x) => [x.id, x.to]));
const queued = queue.filter((r) => r.status === 'approved' && (healed.get(r.id) ?? r.apply_state) === 'queued');
const applying = queue.some((r) => r.status === 'approved' && r.apply_state === 'applying' && !healed.has(r.id));

// 2. Можно ли сейчас
if (!s['apply.enabled']) out.wait = 'disabled';
else if (s['apply.paused']) out.wait = 'paused';
else if (!health) out.wait = 'down';
else if (health.blocked) out.wait = 'blocked';
else if (health.busy || applying) out.wait = 'busy';
else if (today >= limit) out.wait = 'limit';

// 3. Сообщения: блок — один раз на блок (по since), «не отвечает» и «лимит» — раз в «день» робота
const loud = job.fromUser || !quietHours(now);
const BLOCK = {
  captcha: 'капчу hh',
  smart: 'капчу в окне робота',
  login: 'вход в hh',
  limit: 'лимит hh (200 откликов за сутки)',
  errors: 'проверку после сбоев',
  blocked: 'проверку аккаунта',
};
if (out.wait === 'blocked') {
  const b = health.blocked;
  if (state.alertedSince !== b.since) {
    state.alertedSince = b.since;
    const vnc = `«Общий экран» → ${VNC_URL} (режим «Управление»)`;
    const texts = {
      login: `🔑 <b>Робот вышел из hh</b> — очередь ждёт.\nВойдите: ${vnc} или <code>node scripts/applier.mjs login</code>, затем ▶️.`,
      // «Я не робот» или капча внутри окна отклика: ответ на фото отправил бы и сам отклик — решает человек
      smart: `🧩 <b>hh просит капчу</b> — очередь ждёт.\nРешите её в окне робота: ${vnc}, затем ▶️.`,
      errors: `⚠️ <b>Робот трижды подряд не смог откликнуться</b> — пауза. Посмотрите скриншоты; продолжить — ▶️.`,
      limit: `⏸ <b>hh: лимит 200 откликов за сутки</b> — робот ждёт${b.until ? ` до ${localDate(b.until)} ${localTime(b.until)}` : ''}, дальше сам.`,
      blocked: `⛔ <b>hh не принял отклик</b>${b.note ? `: «${esc(b.note)}»` : ''} — робот на паузе. Проверьте аккаунт; продолжить — ▶️.`,
    };
    out.notice =
      b.kind === 'captcha' && b.shot
        ? {
            kind: 'captcha',
            key: `block:${b.since}`,
            shot: b.shot,
            text: `${ROBOT_PROMPTS.captcha} — ответьте на это фото текстом с картинки.\nНе читается — решите в окне робота (${VNC_URL}) и пришлите /go${
              health.fake ? '\n🧪 Фейковый робот: ответьте «ok»' : ''
            }`,
            silent: !loud,
          }
        : {
            kind: 'alert',
            key: `block:${b.since}`,
            shot: b.shot ?? '',
            text: texts[b.kind] ?? `⏸ Робот ждёт: ${BLOCK[b.kind] ?? esc(b.kind)}. Продолжить — ▶️.`,
            silent: !loud,
            button: b.kind !== 'limit',
          };
  }
} else if (state.alertedSince && health) {
  // Блок сняли (▶️, /go, истёк сам) — прошлую тревогу поправить
  out.resolved = {
    messageId: state.alertMessageId ?? 0,
    text: `✅ Робот снова в работе · ${localTime(new Date(now).toISOString())}`,
    // Фото капчи больше не нужно (решили через /go или «Общий экран») — удалить, чтобы на него не отвечали
    promptId: state.captchaPromptId ?? 0,
  };
  state.alertedSince = null;
  state.alertMessageId = null;
  state.captchaPromptId = null;
}
if (!out.notice && out.wait === 'down' && queued.length && state.downDay !== dayKey) {
  state.downDay = dayKey;
  out.notice = {
    kind: 'info',
    key: `down:${dayKey}`,
    text: `⚠️ Робот-отклик не отвечает — очередь (${queued.length}) ждёт.\nЗапуск: <code>scripts/deploy.sh --applier</code>`,
    silent: !loud,
  };
}
if (!out.notice && out.wait === 'limit' && queued.length && state.limitDay !== dayKey) {
  state.limitDay = dayKey;
  out.notice = {
    kind: 'info',
    key: `limit:${dayKey}`,
    text: `⏸ Лимит робота на сегодня — ${limit} откликов. Очередь (${queued.length}) уйдёт после 09:00; поменять — ⚙️ → 🚀 Робот`,
    silent: true,
  };
}

// 4. Нажали 🚀, а робот ждёт — письмо сразу говорит, чего
const WAIT = { paused: 'снятия паузы (⚙️ → 🚀 Робот)', down: 'запуска робота', blocked: BLOCK[health?.blocked?.kind] ?? 'проверки', limit: 'завтра, после 09:00 (лимит дня)' };
if (job.fromUser && job.op === 'enqueue' && WAIT[out.wait]) {
  const r = queued.find((x) => x.id === job.id);
  if (r) {
    out.views.push({
      id: r.id,
      chatId: job.chatId,
      messageId: r.tg_letter_id,
      layout: 'wait',
      url: r.url,
      apply_url: r.apply_url,
      text: letterText({ ...r, ok: Boolean(r.letter), mode: 'new', robot_wait: WAIT[out.wait] }),
    });
  }
}

// 5. Кого отправлять
if (!out.wait && queued.length) out.next = queued[0];
return [{ json: out }];
