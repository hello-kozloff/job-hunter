// W7 · Render — панель «🤖 Автоотклик» (6.1c, 20.10.2026, docs/stages/stage-6.md → «6.1c Автоотклик»). Подключается
// в render.js строкой «// @include n8n/w7-menu/auto-view.js» после settings-view.js (settings с изменением этого
// нажатия, ranNode, robotState) и n8n/shared/auto.js.
// Состояние, счётчики дня и часа, когда следующий отклик, сколько возьмёт, журнал последних попыток робота. Кнопки:
// ▶️ Запустить / ⏹ Остановить (au:on | au:off — значение явное), 🔄 Обновить (au:r), ⚙️ темп и лимиты, ▶️ после блока.
// Панель сама обновляется после каждого отклика робота (W9 «Panel sync» → sync), пока она текущая.

const AUTO_BLOCK = {
  captcha: 'капчу hh — ответь на фото',
  smart: 'капчу в окне робота',
  login: 'вход в hh',
  limit: 'лимит hh (200 откликов за сутки)',
  errors: 'проверку после трёх сбоев подряд',
  blocked: 'проверку аккаунта',
};

function autoView() {
  const on = autoOn(settings);
  const h = ranNode('Robot health')[0] ?? {};
  const up = Boolean(h.ok && !h.error);
  const pace = robotPace(settings);
  const limit = settings['apply.daily_limit'];
  const today = robotToday(rows, now);
  const hour = Number(h.pace?.hour) || 0;
  const nextAt = Date.parse(h.pace?.nextAt ?? '') || 0;
  const pipe = autoPipeline(rows);
  const { letters, ready } = autoCandidates(rows, settings, now);
  const take = letters.length + ready.length;

  let state = '⚪ <b>выключен</b>';
  if (on) {
    const since = Date.parse(settings['apply.auto_since']) ? ` · с ${localDate(settings['apply.auto_since'])} ${localTime(settings['apply.auto_since'])}` : '';
    const wait = settings['apply.paused']
      ? '⏸ очередь на паузе (⚙️ → 🚀 Робот)'
      : !up
        ? '⚠️ робот не отвечает — <code>scripts/deploy.sh --applier</code>'
        : h.blocked
          ? `⏸ ждёт ${AUTO_BLOCK[h.blocked.kind] ?? esc(h.blocked.kind)}, потом ▶️`
          : !h.loggedIn
            ? '🔑 робот не вошёл в hh'
            : !autoWindow(now)
              ? '🌙 ночь (тихие часы) — продолжит в 09:00'
              : today >= limit
                ? '⏸ лимит дня — продолжит завтра после 09:00'
                : hour >= pace.hour
                  ? `⏸ лимит часа (${pace.hour})`
                  : '';
    state = wait ? `🟢 включён · ${wait}${since}` : `🟢 <b>работает</b>${since}`;
  }
  const lines = [
    `🤖 <b>Автоотклик</b>: ${state}`,
    '',
    `Сегодня: ${today} из ${limit} · за час: ${up ? `${hour} из ${pace.hour}` : '—'} · темп: ${pace.name} (${paceGap(pace)})`,
    on ? `${nextAt > now ? `Следующий — не раньше ${localTime(new Date(nextAt).toISOString())} · ` : ''}в очереди: ${pipe.queued} · пишу письма: ${pipe.writing}` : null,
    `${on ? 'Возьмёт ещё' : 'Возьмёт'}: ${take}${take ? ` — 🤖 нейросеть ${letters.length} · ✅ с письмом ${ready.length}` : ''} · ${settings['apply.backlog'] ? 'хвост за 3 дня' : 'только новые после включения'}, свежие первыми`,
    up && h.fake ? '🧪 Фейковый робот (APPLIER_FAKE=1): отклики не настоящие' : null,
    up && !h.fake && !h.live ? '🧪 APPLY_LIVE=0: робот делает только сухой прогон, отклики не уходят' : null,
    ...(on
      ? []
      : [
          '',
          'Запустить — робот сам возьмёт ✅ и карточки с apply нейросети, напишет письма (тихо, ответом на карточку) и откликнется. Вопросы работодателя и сайт работодателя — тебе. Ночью (23–09) ждёт. Остановить — ⏹ здесь или ⛔ под письмом.',
        ]),
    '',
    '<b>Журнал</b> (🤖 — автоотклик)',
    ...(autoJournal(rows).length ? autoJournal(rows) : ['<i>пока пусто</i>']),
  ];
  const notes = changeNotes();
  if (notes.length) lines.push('', ...notes);
  const shown = lines.filter((line) => line !== null);
  return {
    layout: 'auto',
    text: shown.filter((line, i) => line !== '' || shown[i - 1] !== '').join('\n'),
    b: {
      toggle: on ? { text: '⏹ Остановить', cb: 'au:off' } : { text: `▶️ Запустить${take ? ` (${take})` : ''}`, cb: 'au:on' },
    },
  };
}
