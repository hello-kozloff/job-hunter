// W9 · Gate — очередь робота: починка, можно ли сейчас отправлять, кого следующим, о чём сообщить.
// Нода: Code, режим «Run Once for All Items». Вход: «Queue» — строки в очереди (apply_state ≠ ''), «Today» — живые
// отклики робота за двое суток («день» с 09:00 по местному считает robotToday), «Health» — GET /health робота (ошибка — не отвечает), «Job», «Settings»;
// напоминания (6.3): «Remind queue» — строки в их очереди (remind_state ≠ ''), «Remind today» — попытки за двое суток.
// Static data (global): alertedSince — блок, о котором уже сообщили (одна тревога на блок, по since);
//   alertMessageId — та тревога (снят блок → «✅ снова в работе»); downDay, limitDay — сообщения «не отвечает» и
//   «лимит» — раз в «день» робота.
// Выход: { heal[], next, wait, notice, resolved, views[], pace, today, limit, auto }
//   heal — починка: applying дольше 6 мин (n8n или робот упали посреди отклика) → queued; в очереди, но решение
//          сменили (не ✅) или резюме вакансии больше не связано с hh → снять. Повтор безопасен: робот перед кликом
//          проверяет «уже откликались» на hh;
//   next — кого отправлять (старейшая queued, + resume { hash, title } — каким резюме hh откликаться); null — нельзя:
//          wait = disabled | paused | down | blocked | busy | limit | hour (лимит часа) | pace (пауза между откликами) |
//          night (в очереди только автоотклик, а сейчас тихие часы — 6.1c);
//   pace — темп для POST /apply { min, max, hour } (⚙️ → 🚀 Робот, n8n/shared/robot.js → PACE); today, limit — отклики
//          за «день» и лимит дня (их ждёт «Feed» автоотклика);
//   notice — сообщение: { kind: captcha | alert | info, key, text, shot, silent, button }; key — для POST /notice
//            робота: параллельные запуски W9 видят один блок, а отправит тревогу только первый;
//   resolved — блок снят: { messageId, text, promptId } — поправить прошлую тревогу и удалить фото капчи;
//   views — письма, которые перерисовать (нажали 🚀, а робот ждёт: «⏸ Робот ждёт: …»);
//   remindHeal, remind, remindWait — вторая полоса, напоминания (6.3): та же починка; remind — кому напомнить (+ text),
//          только когда отклик в этот тик не выбран и робот свободен (отклики первыми, решение пользователя);
//          remindWait = disabled | paused | down | blocked | busy | limit (remind.daily_limit) | pace | hour (лимит часа
//          робота); тихих часов у напоминаний нет (решение пользователя: «когда угодно»).

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/settings.js
// @include n8n/shared/resumes.js
// @include n8n/shared/robot.js
// @include n8n/shared/letter.js
// @include n8n/shared/menu.js
// @include n8n/shared/remind.js

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
// Темп (6.1c): пауза и лимит часа держит робот — n8n смотрит его /health, чтобы не звать зря
const pace = robotPace(s);
const robotPaceNow = health?.pace ?? {};
const nextAt = Date.parse(robotPaceNow.nextAt ?? '') || 0;
const out = {
  heal: [],
  next: null,
  wait: '',
  notice: null,
  resolved: null,
  views: [],
  pace: { min: pace.min, max: pace.max, hour: pace.hour },
  today,
  limit,
  // Автоотклик включён — ветка «Feed» (6.1c)
  auto: Boolean(s['apply.enabled'] && s['apply.auto']),
  remindHeal: [],
  remind: null,
  remindWait: '',
};

// 1. Починка
for (const r of queue) {
  // Резюме вакансии расстались с hh уже после 🚀 (удалили, отвязали) — из очереди: откликнулись бы не тем
  if (r.status !== 'approved' || !robotResume(s, r).ok) out.heal.push({ id: r.id, to: '' });
  else if (r.apply_state === 'applying' && now - Date.parse(r.updatedAt) > 6 * 60 * 1000) out.heal.push({ id: r.id, to: 'queued' });
}
const healed = new Map(out.heal.map((x) => [x.id, x.to]));
const queued = queue.filter((r) => r.status === 'approved' && (healed.get(r.id) ?? r.apply_state) === 'queued');
const applying = queue.some((r) => r.status === 'approved' && r.apply_state === 'applying' && !healed.has(r.id));
// Ночью (тихие часы) автоотклик ждёт, вакансии по 🚀 — уходят как раньше
const night = quietHours(now);
const sendable = queued.filter((r) => !(night && r.apply_mode === 'auto'));

// 2. Можно ли сейчас
if (!s['apply.enabled']) out.wait = 'disabled';
else if (s['apply.paused']) out.wait = 'paused';
else if (!health) out.wait = 'down';
else if (health.blocked) out.wait = 'blocked';
else if (health.busy || applying) out.wait = 'busy';
else if (today >= limit) out.wait = 'limit';
else if ((Number(robotPaceNow.hour) || 0) >= pace.hour) out.wait = 'hour';
else if (nextAt > now) out.wait = 'pace';
else if (queued.length && !sendable.length) out.wait = 'night';

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
      blocked: `⛔ <b>hh не принял ${b.source === 'remind' ? 'напоминание' : 'отклик'}</b>${b.note ? `: «${esc(b.note)}»` : ''} — робот на паузе. Проверьте аккаунт; продолжить — ▶️.`,
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
// Автоотклик (6.1c): лимит дня видно на панели 🤖 — отдельным сообщением не пишем
if (!out.notice && out.wait === 'limit' && queued.length && !out.auto && state.limitDay !== dayKey) {
  state.limitDay = dayKey;
  out.notice = {
    kind: 'info',
    key: `limit:${dayKey}`,
    text: `⏸ Лимит робота на сегодня — ${limit} откликов. Очередь (${queued.length}) уйдёт после 09:00; поменять — ⚙️ → 🚀 Робот`,
    silent: true,
  };
}

// 4. Нажали 🚀, а робот ждёт — письмо сразу говорит, чего
const WAIT = {
  paused: 'снятия паузы (⚙️ → 🚀 Робот)',
  down: 'запуска робота',
  blocked: BLOCK[health?.blocked?.kind] ?? 'проверки',
  limit: 'завтра, после 09:00 (лимит дня)',
  hour: `следующего часа (лимит — ${pace.hour} в час)`,
  pace: `паузы между откликами (до ${localTime(new Date(nextAt || now).toISOString())})`,
};
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
if (!out.wait && sendable.length) out.next = { ...sendable[0], resume: robotResume(s, sendable[0]).resume };

// 6. Напоминания (6.3): своя очередь. Починка: отклик отменили (статус не applied) — снять; sending дольше 6 мин (n8n
// или робот упали посреди) — снова в очередь: перед отправкой робот проверит, нет ли напоминания в чате
const reminders = $('Remind queue')
  .all()
  .map((i) => i.json)
  .filter((r) => r.id && r.remind_state);
for (const r of reminders) {
  if (r.status !== 'applied') out.remindHeal.push({ id: r.id, to: '' });
  else if (r.remind_state === 'sending' && now - Date.parse(r.updatedAt) > 6 * 60 * 1000) out.remindHeal.push({ id: r.id, to: 'queued' });
}
const remindHealed = new Map(out.remindHeal.map((x) => [x.id, x.to]));
const remindQueued = reminders
  .filter((r) => r.status === 'applied' && (remindHealed.get(r.id) ?? r.remind_state) === 'queued')
  .sort((a, b) => (Date.parse(b.applied_at) || 0) - (Date.parse(a.applied_at) || 0));
const reminding = reminders.some((r) => r.status === 'applied' && r.remind_state === 'sending' && !remindHealed.has(r.id));
const remindLimit = s['remind.daily_limit'];
const remindHourCap = Number(robotPaceNow.remindHourCap) || Infinity;
if (remindQueued.length) {
  const day = remindDay(
    $('Remind today')
      .all()
      .map((i) => i.json)
      .filter((r) => r.id),
    now,
  );
  if (!s['apply.enabled']) out.remindWait = 'disabled';
  else if (s['apply.paused']) out.remindWait = 'paused';
  else if (!health) out.remindWait = 'down';
  else if (health.blocked) out.remindWait = 'blocked';
  else if (out.next || applying || reminding || health.busy) out.remindWait = 'busy';
  else if (day >= remindLimit) out.remindWait = 'limit';
  else if (nextAt > now) out.remindWait = 'pace';
  else if ((Number(robotPaceNow.remindHour) || 0) >= remindHourCap) out.remindWait = 'hour';
  if (!out.remindWait) out.remind = { ...remindQueued[0], text: s['remind.text'] };
}
return [{ json: out }];
