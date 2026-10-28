// Напоминания об откликах (этап 6.3, 28.10.2026, docs/stages/stage-6.md → 6.3): кто кандидат, строка карточки,
// журнал панели 🔔, счёт «дня». Общий для W7 (панель, карточка, список), W9 (очередь) и W6 (сводка).
// Подключается после n8n/shared/time.js, card.js (esc) и robot.js (robotDayStart). Все имена — с remind / REMIND_:
// файлы n8n/shared склеиваются в одну область видимости (в W7 рядом auto.js со своим cut).
// Решения пользователя: только «не просмотрен» (проверяет робот), один раз, через 3 дня после отклика, все старше
// 3 дней без верхней границы; текст — настройка remind.text, лимит — remind.daily_limit.

const REMIND_AFTER_MS = 3 * 24 * 3600 * 1000;
// Итог — больше не напоминать: отправлено (или уже было в чате) либо hh сказал, что незачем или нельзя
const REMIND_FINAL = new Set(['sent', 'already', 'viewed', 'invited', 'rejected', 'wrote', 'closed', 'archived', 'no_topic']);
// «Рано» по hh (отклику меньше 72 ч по его дате) — снова кандидат через сутки
const REMIND_RETRY_MS = 24 * 3600 * 1000;

const remindCut = (text, n) => (String(text ?? '').length > n ? `${String(text).slice(0, n - 1)}…` : String(text ?? ''));

// Отклик «старше 3 дней»: без даты отклика (старые строки) — старый
const remindAge = (r, now) => now - (Date.parse(r.applied_at) || 0);
// Когда отклику исполнится 3 дня
const remindFrom = (r) => (Date.parse(r.applied_at) || 0) + REMIND_AFTER_MS;

// Кандидат в напоминание: отправлен на hh (не на сайт работодателя), 3+ дня, не в очереди напоминаний, итога нет
function remindable(r, now = Date.now()) {
  if (r.status !== 'applied' || r.apply_type === 'external' || r.remind_state) return false;
  if (REMIND_FINAL.has(r.remind_result)) return false;
  if (r.remind_result === 'too_early' && now - (Date.parse(r.remind_at) || 0) < REMIND_RETRY_MS) return false;
  return remindAge(r, now) >= REMIND_AFTER_MS;
}

// Кандидаты — свежие отклики первыми: старые чаще уже закрыты
const remindCandidates = (rows, now = Date.now()) =>
  rows.filter((r) => remindable(r, now)).sort((a, b) => (Date.parse(b.applied_at) || 0) - (Date.parse(a.applied_at) || 0));

// Напоминаний за текущий «день» робота (с 09:00 по местному) — для лимита: только отправленные сейчас
const remindDay = (rows, now = Date.now()) =>
  rows.filter((r) => r.remind_result === 'sent' && Date.parse(r.remind_at) >= robotDayStart(now)).length;

const REMIND_ICON = {
  sent: '🔔',
  already: '🔔',
  viewed: '👀',
  invited: '🎉',
  rejected: '❌',
  wrote: '💬',
  closed: '🔒',
  archived: '🔒',
  no_topic: '❓',
  too_early: '⏳',
  error: '⚠️',
  dry_run: '🧪',
};
const REMIND_WORD = {
  already: 'уже было в чате',
  viewed: 'отклик уже открыли',
  invited: 'приглашение',
  rejected: 'отказ',
  wrote: 'в чате уже писали',
  closed: 'писать нельзя',
  archived: 'закрыта',
  no_topic: 'отклика нет на hh',
  too_early: 'рано по hh',
  error: 'не вышло',
  dry_run: 'сухой прогон',
};

// Строка карточки /v<id> про напоминание — только у отправленных откликов
function remindLine(r, now = Date.now()) {
  if (r.status !== 'applied') return '';
  if (r.remind_state === 'queued') return '🔔 Напоминание в очереди робота — ⏹ на панели 🔔 снимет';
  if (r.remind_state === 'sending') return '🔔 Робот пишет напоминание…';
  const at = Date.parse(r.remind_at) ? ` ${localDate(r.remind_at)} ${localTime(r.remind_at)}` : '';
  const note = r.remind_note ? `: ${esc(remindCut(r.remind_note, 120))}` : '';
  switch (r.remind_result) {
    case 'sent':
      return `🔔 Напомнил${at}`;
    case 'already':
      return `🔔 Напоминание уже было в чате${at}`;
    case 'viewed':
      return `👀 Работодатель уже открыл отклик — не напоминал${at}`;
    case 'invited':
      return `🎉 На hh — приглашение, напоминать незачем${at}`;
    case 'rejected':
      return `❌ На hh — отказ, напоминать незачем${at}`;
    case 'wrote':
      return `💬 В чате отклика уже писали — не напоминал${at}`;
    case 'closed':
      return `🔒 В чат отклика писать нельзя${note}`;
    case 'archived':
      return '🔒 Вакансия закрыта — не напоминал';
    case 'no_topic':
      return '❓ Отклика на hh нет — не напоминал';
    case 'dry_run':
      return `🧪 Сухой прогон напоминания${at} (REMIND_LIVE=0)`;
    case 'error':
      return `⚠️ Напоминание не вышло${at}${note} — можно ещё раз`;
    case 'too_early':
      return `⏳ hh: отклику меньше 3 дней — напомню позже`;
    default:
  }
  if (r.apply_type === 'external') return '';
  if (remindAge(r, now) < REMIND_AFTER_MS) return `🔔 Напомнить можно с ${localDate(new Date(remindFrom(r)).toISOString())}`;
  return '🔔 Можно напомнить работодателю';
}

// Журнал панели 🔔: последние попытки робота по remind_at — время, исход, вакансия
function remindJournal(rows, n = 8) {
  return rows
    .filter((r) => Date.parse(r.remind_at) && REMIND_ICON[r.remind_result])
    .sort((a, b) => Date.parse(b.remind_at) - Date.parse(a.remind_at))
    .slice(0, n)
    .map((r) => {
      const word = REMIND_WORD[r.remind_result] ? ` · ${REMIND_WORD[r.remind_result]}` : '';
      return `${localDate(r.remind_at)} ${localTime(r.remind_at)} ${REMIND_ICON[r.remind_result]} ${esc(remindCut(r.title, 40))} — ${esc(remindCut(r.company, 24))}${word} /v${r.id}`;
    });
}
