// Общий код робота-отклика (этап 6, docs/stages/stage-6.md): W3, W5, W6, W7, W9.
// Подключается строкой «// @include n8n/shared/robot.js» после n8n/shared/time.js и n8n/shared/card.js (нужны TZ,
// localDate, localTime и esc).

const VNC_URL = 'vnc://localhost:5901';

// Можно ли откликнуться роботом: ✅ с письмом, без теста работодателя и не на сайте работодателя, не в очереди.
// enabled — настройка apply.enabled (W3 её не читает: выключенного робота поймает W9 при нажатии)
const robotEligible = (r, enabled = true) =>
  Boolean(enabled && r?.status === 'approved' && r.letter && !r.has_test && r.apply_type !== 'external' && !r.apply_state);

// Каким резюме hh откликаться (несколько резюме, docs/resumes.md): резюме вакансии — resume_id (пусто — основное).
// Нужен n8n/shared/resumes.js. → { ok: true, resume: { hash, title } } — резюме связано с резюме на hh, робот выберет его
// в окне отклика; { ok: true, resume: null } — основное не связано: робот откликнется резюме по умолчанию (как раньше);
// { ok: false, reason } — другое резюме не связано с hh: роботом откликаться нельзя, откликнулось бы не тем резюме
function robotResume(s, row) {
  const id = row?.resume_id && resumeById(s, row.resume_id) ? row.resume_id : 'r1';
  const r = resumeById(s, id);
  if (r?.hh?.hash) return { ok: true, resume: { hash: r.hh.hash, title: r.hh.title } };
  if (id === 'r1') return { ok: true, resume: null };
  return {
    ok: false,
    reason: `резюме «${r?.name ?? id}» не связано с резюме на hh: импортируйте его (⚙️ → 📄 Резюме → 📥 Импорт с hh) или откликнитесь вручную`,
  };
}

// «День» робота для лимита — с 09:00 по местному (решение пользователя 10.10.2026): отложенные на завтра отклики
// уходят, когда тихие часы (23–09) закончились
const robotDayStart = (now = Date.now(), tz = TZ) => localDayStart(now, tz, 9);
// Живые отклики робота за текущий «день»
const robotToday = (rows, now = Date.now()) =>
  rows.filter((r) => r.apply_by === 'robot' && Date.parse(r.applied_at) >= robotDayStart(now)).length;

// Как ушло письмо — в строку «🚀 Отправлено»
const LETTER_HOW = { attached: ' · ✉️ письмо приложено', chat: ' · 💬 письмо — в чате отклика', none: ' · ⚠️ без письма' };

// Строка робота в сообщении с письмом: очередь, итог, пометка. r — строка вакансии
// (+ robot_wait — чего ждёт робот: «капчу hh», «вход в hh»…)
function robotLine(r) {
  if (r.apply_state === 'queued' || r.apply_state === 'applying') {
    return r.robot_wait ? `⏸ Робот ждёт: ${esc(r.robot_wait)}` : '⏳ Робот откликается…';
  }
  if (r.status === 'applied' && r.apply_by === 'robot') {
    return `🚀 Отправлено ${localDate(r.applied_at)} ${localTime(r.applied_at)}${LETTER_HOW[r.apply_letter] ?? ''}${
      r.apply_note ? `\n⚠️ hh: ${esc(r.apply_note)}` : ''
    }`;
  }
  if (r.status === 'applied' && r.apply_by === 'hh') return '📨 Отклик уже был на hh — отметил';
  if (r.status !== 'approved') return '';
  const note = r.apply_note ? `: ${esc(r.apply_note)}` : '';
  const lines = {
    test: '🧩 У вакансии вопросы работодателя — откликнитесь сами',
    external: '🌐 Отклик на сайте работодателя — откликнитесь сами',
    // Скрыто конкретное резюме (несколько резюме, этап 5): робот называет его в заметке
    hidden: `🙈 ${/^резюме/.test(r.apply_note ?? '') ? esc(r.apply_note) : 'hh просит открыть резюме этому работодателю'} — откликнитесь сами`,
    error: `⚠️ Робот не смог${note}${(r.apply_tries ?? 0) >= 3 ? ' — третий раз, откликнитесь сами' : ''}`,
    dry_run: `🧪 Сухой прогон (APPLY_LIVE=0), отклик не отправлен${note}`,
    disabled: '⏸ Робот выключен (⚙️ → 🚀 Робот) — откликнитесь сами',
    no_resume: `📄 Робот не откликается: ${esc(r.apply_note || 'резюме не связано с резюме на hh')}`,
  };
  return lines[r.apply_result] ?? '';
}
