// W7 · Render — панель «🔔 Напоминания» (6.3, 28.10.2026, docs/stages/stage-6.md → 6.3). Подключается в render.js
// строкой «// @include n8n/w7-menu/remind-view.js» после auto-view.js (settings, ranNode, AUTO_BLOCK) и
// n8n/shared/remind.js. Сколько можно напомнить, сегодня из лимита, очередь, состояние робота, текст, журнал попыток.
// Кнопки: 🔔 Напомнить всем (nr:all), ⏹ Остановить (nr:stop), 🔄 Обновить (nr:p), ⬅️ К списку («📨 Отправлено»).
// Панель сама обновляется после каждого напоминания (W9 «Remind sync» → sync), пока она текущая.

function remindView() {
  const h = ranNode('Robot health')[0] ?? {};
  const up = Boolean(h.ok && !h.error);
  const limit = settings['remind.daily_limit'];
  const today = remindDay(rows, now);
  const candidates = remindCandidates(rows, now);
  const queued = count(rows, (r) => r.remind_state === 'queued');
  const sending = rows.some((r) => r.remind_state === 'sending');
  const nextAt = Date.parse(h.pace?.nextAt ?? '') || 0;
  const state = !settings['apply.enabled']
    ? '⚪ робот выключен — ⚙️ → 🚀 Робот'
    : settings['apply.paused']
      ? '⏸ робот на паузе — ⚙️ → 🚀 Робот'
      : !up
        ? '⚠️ робот не отвечает — <code>scripts/deploy.sh --applier</code>'
        : h.blocked
          ? `⏸ ждёт ${AUTO_BLOCK[h.blocked.kind] ?? esc(h.blocked.kind)}, потом ▶️`
          : !h.loggedIn
            ? '🔑 робот не вошёл в hh'
            : queued && today >= limit
              ? '⏸ лимит дня — продолжит завтра после 09:00'
              : sending
                ? '✍️ пишет напоминание…'
                : queued && count(rows, (r) => r.apply_state)
                  ? '⏳ сначала отклики — напоминания следом'
                  : '';
  const total = (...keys) => count(rows, (r) => keys.includes(r.remind_result));
  const lines = [
    '🔔 <b>Напоминания</b>',
    '',
    `Можно напомнить: ${candidates.length} — отклики старше 3 дней без напоминания; напомню только непросмотренным (робот проверит на hh)`,
    `Сегодня: ${today} из ${limit} · в очереди: ${queued}${nextAt > now && (queued || sending) ? ` · следующее — не раньше ${localTime(new Date(nextAt).toISOString())}` : ''}`,
    state ? `Состояние: ${state}` : null,
    up && h.fake ? '🧪 Фейковый робот (APPLIER_FAKE=1): напоминания не настоящие' : null,
    up && !h.fake && h.remindLive === false ? '🧪 REMIND_LIVE=0: робот доходит до поля в чате и не пишет' : null,
    `Текст: «${esc(settings['remind.text'])}»`,
    `Всего: 🔔 ${total('sent', 'already')} · 👀 ${total('viewed')} · 🎉 ${total('invited')} · ❌ ${total('rejected')} · 🔒 ${total('closed', 'archived')}`,
    '',
    '<b>Журнал</b>',
    ...(remindJournal(rows).length ? remindJournal(rows) : ['<i>пока пусто</i>']),
  ];
  return {
    layout: 'remind',
    tab: 'sent',
    page: 1,
    text: lines.filter((line) => line !== null).join('\n'),
    b: { all: { text: `🔔 Напомнить всем (${candidates.length})`, cb: 'nr:all' } },
  };
}
