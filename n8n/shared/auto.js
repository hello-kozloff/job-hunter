// Автоотклик (6.1c, 20.10.2026, docs/stages/stage-6.md → «6.1c Автоотклик»): какие вакансии робот берёт сам,
// сколько их в работе и журнал панели «🤖 Автоотклик». Одна правда для W9 «Feed» (кого брать), W7 (панель: «возьмёт N»,
// журнал) и W6 (строка сводки).
// Подключается после n8n/shared/time.js, card.js, settings.js, resumes.js и robot.js (нужны quietHours, localTime,
// esc, resumeList, robotResume).
//
// Решения пользователя (20.10.2026): берём ✅ пользователя и карточки с apply нейросети — сразу, без окна на отмену;
// вопросы работодателя и сайт работодателя — человеку; хвост — карточки за 3 дня (W6 через 3 дня без решения пишет
// «⌛ устарела»), свежие первыми; ночью (тихие часы 23–09 по местному) автоотклик ждёт.

const AUTO_FRESH_MS = 3 * 24 * 3600 * 1000;
// Письмо к захваченной вакансии не вышло (Gemini 503 и т. п.) — ещё одна попытка через 15 мин, потом решает человек
const AUTO_LETTER_RETRY_MS = 15 * 60 * 1000;
const AUTO_LETTER_TRIES = 2;
// Захват без письма дольше 10 мин — W5 упал, не дойдя до «Unlock»: вакансию — назад в «ждут решения»
const AUTO_STALE_MS = 10 * 60 * 1000;
// В очереди робота + пишутся письма — не больше: письма пишутся под темп робота, а не на весь хвост сразу
const AUTO_DEPTH = 2;

const autoOn = (s) => Boolean(s['apply.enabled'] && s['apply.auto']);
// Часы автоотклика: вне тихих часов по местному
const autoWindow = (now = Date.now()) => !quietHours(now);

// Кандидаты: letters — карточки с apply нейросети (захватить → письмо W5 → очередь), ready — ✅ с письмом, которые
// робот ещё не пробовал (сразу в очередь), stale — захваты, где письмо так и не пришло. Свежие карточки первыми
function autoCandidates(rows, s, now = Date.now()) {
  const off = new Set(resumeList(s).filter((r) => !r.active).map((r) => r.id));
  const since = s['apply.backlog'] ? now - AUTO_FRESH_MS : Math.max(now - AUTO_FRESH_MS, Date.parse(s['apply.auto_since']) || now);
  const usable = (r) =>
    Date.parse(r.card_at) >= since &&
    !r.has_test &&
    r.apply_type !== 'external' &&
    !r.apply_state &&
    !r.letter_lock &&
    // Вакансии выключенного резюме не показываются в списке (PR #116) — и роботу их не брать
    !off.has(r.resume_id || 'r1') &&
    robotResume(s, r).ok;
  const retry = (r) =>
    !r.apply_result ||
    (r.apply_result === 'no_letter' &&
      (Number(r.apply_tries) || 0) < AUTO_LETTER_TRIES &&
      now - (Date.parse(r.apply_queued_at) || 0) >= AUTO_LETTER_RETRY_MS);
  const newest = (a, b) => Date.parse(b.card_at) - Date.parse(a.card_at);
  return {
    letters: rows
      .filter((r) => r.status === 'waiting' && r.decision === 'apply' && !r.my_decision && r.tg_message_id && usable(r) && retry(r))
      .sort(newest),
    ready: rows.filter((r) => r.status === 'approved' && r.letter && r.tg_letter_id && !r.apply_result && usable(r)).sort(newest),
    stale: rows.filter(
      (r) =>
        r.status === 'approved' &&
        r.apply_mode === 'auto' &&
        !r.letter &&
        !r.apply_state &&
        r.letter_lock &&
        now - Date.parse(r.letter_lock) > AUTO_STALE_MS,
    ),
  };
}

// В работе у автоотклика: queued — в очереди робота (и отправляется), writing — пишутся письма к захваченным
function autoPipeline(rows) {
  const queued = rows.filter((r) => r.apply_state).length;
  const writing = rows.filter((r) => r.status === 'approved' && r.apply_mode === 'auto' && !r.letter && r.letter_lock && !r.apply_state).length;
  return { queued, writing, total: queued + writing };
}

// Журнал (панель 🤖): последние попытки робота по apply_at — исход, как ушло письмо, кто поставил в очередь
const AUTO_ICON = {
  applied: '🚀',
  already: '📨',
  test: '🧩',
  external: '🌐',
  hidden: '🙈',
  archived: '🔒',
  error: '⚠️',
  dry_run: '🧪',
  stopped: '⛔',
  no_letter: '✉️',
  no_resume: '📄',
};
const AUTO_WORD = {
  already: 'уже был на hh',
  test: 'вопросы работодателя — сам',
  external: 'сайт работодателя — сам',
  hidden: 'резюме скрыто — сам',
  archived: 'закрыта',
  error: 'не смог',
  dry_run: 'сухой прогон',
  stopped: 'убрал из очереди',
  no_letter: 'письмо не вышло',
  no_resume: 'резюме не связано с hh',
};
const AUTO_LETTER = { attached: '✉️', chat: '💬', none: '⚠️ без письма' };
const cut = (text, n) => (String(text ?? '').length > n ? `${String(text).slice(0, n - 1)}…` : String(text ?? ''));

function autoJournal(rows, n = 8) {
  return rows
    .filter((r) => Date.parse(r.apply_at) && AUTO_ICON[r.apply_result])
    .sort((a, b) => Date.parse(b.apply_at) - Date.parse(a.apply_at))
    .slice(0, n)
    .map((r) => {
      const how = r.apply_result === 'applied' ? (AUTO_LETTER[r.apply_letter] ?? '') : '';
      const word = AUTO_WORD[r.apply_result] ? ` · ${AUTO_WORD[r.apply_result]}` : '';
      return `${localTime(r.apply_at)} ${r.apply_mode === 'auto' ? '🤖' : ''}${AUTO_ICON[r.apply_result]}${how} ${esc(cut(r.title, 40))} — ${esc(cut(r.company, 24))}${word} /v${r.id}`;
    });
}
