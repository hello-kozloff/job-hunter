// Общий код робота-отклика (этап 6, docs/stages/stage-6.md): W3, W5, W6, W7, W9.
// Подключается строкой «// @include n8n/shared/robot.js» после n8n/shared/card.js (нужны esc и thaiDate).

const VNC_URL = 'vnc://localhost:5901';
const DAY_MS = 24 * 3600 * 1000;

// Можно ли откликнуться роботом: ✅ с письмом, без теста работодателя и не на сайте работодателя, не в очереди.
// enabled — настройка apply.enabled (W3 её не читает: выключенного робота поймает W9 при нажатии)
const robotEligible = (r, enabled = true) =>
  Boolean(enabled && r?.status === 'approved' && r.letter && !r.has_test && r.apply_type !== 'external' && !r.apply_state);

// «День» робота для лимита — с 09:00 по Таиланду (02:00 UTC), решение пользователя 10.10.2026
function robotDayStart(now = Date.now()) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 2);
  return start > now ? start - DAY_MS : start;
}
// Живые отклики робота за текущий «день»
const robotToday = (rows, now = Date.now()) =>
  rows.filter((r) => r.apply_by === 'robot' && Date.parse(r.applied_at) >= robotDayStart(now)).length;

// Тихие часы 23:00–09:00 по Таиланду (UTC+7)
function quietHours(now = Date.now()) {
  const h = new Date(now + 7 * 3600 * 1000).getUTCHours();
  return h >= 23 || h < 9;
}

// Время по Таиланду: '2026-10-11T07:32:00Z' → '14:32'
const thaiTime = (iso) =>
  Date.parse(iso) ? new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString().slice(11, 16) : '';

// Как ушло письмо — в строку «🚀 Отправлено»
const LETTER_HOW = { attached: ' · ✉️ письмо приложено', chat: ' · 💬 письмо — в чате отклика', none: ' · ⚠️ без письма' };

// Строка робота в сообщении с письмом: очередь, итог, пометка. r — строка вакансии
// (+ robot_wait — чего ждёт робот: «капчу hh», «вход в hh»…)
function robotLine(r) {
  if (r.apply_state === 'queued' || r.apply_state === 'applying') {
    return r.robot_wait ? `⏸ Робот ждёт: ${esc(r.robot_wait)}` : '⏳ Робот откликается…';
  }
  if (r.status === 'applied' && r.apply_by === 'robot') {
    return `🚀 Отправлено ${thaiDate(r.applied_at)} ${thaiTime(r.applied_at)}${LETTER_HOW[r.apply_letter] ?? ''}${
      r.apply_note ? `\n⚠️ hh: ${esc(r.apply_note)}` : ''
    }`;
  }
  if (r.status === 'applied' && r.apply_by === 'hh') return '📨 Отклик уже был на hh — отметил';
  if (r.status !== 'approved') return '';
  const note = r.apply_note ? `: ${esc(r.apply_note)}` : '';
  const lines = {
    test: '🧩 У вакансии вопросы работодателя — откликнитесь сами',
    external: '🌐 Отклик на сайте работодателя — откликнитесь сами',
    hidden: '🙈 hh просит открыть резюме этому работодателю — откликнитесь сами',
    error: `⚠️ Робот не смог${note}${(r.apply_tries ?? 0) >= 3 ? ' — третий раз, откликнитесь сами' : ''}`,
    dry_run: `🧪 Сухой прогон (APPLY_LIVE=0), отклик не отправлен${note}`,
    disabled: '⏸ Робот выключен (⚙️ → 🚀 Робот) — откликнитесь сами',
  };
  return lines[r.apply_result] ?? '';
}
