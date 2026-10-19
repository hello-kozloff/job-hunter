// Теневой режим (этап 3): карточки на все оценки нейросети, пользователь жмёт ✅ / 🤔 / ❌ — считаем совпадения.
// Счёт с нуля (19.10.2026): настройка llm.shadow_since — с какой минуты считать (⚙️ → 🤖 → «🔄 Теневой заново»).
// Пары, у которых карточка ушла раньше, оценены прежними правилами и в счёт не идут; оценки в таблице не меняются.
// Пустая метка — все карточки.
// Пара — решения нейросети (decision) и пользователя (my_decision) из apply / maybe / skip: «📨 откликался раньше»
// (earlier) не сравниваем — отклик был до бота; error — нейросеть не ответила.
// Общий код W6 (утренняя сводка) и W7 (📊 Статистика, ⚙️ → 🤖): строка «// @include n8n/shared/shadow.js» после
// n8n/shared/time.js (localDate).

const SHADOW_GOAL = 50;
const SHADOW_DECISIONS = ['apply', 'maybe', 'skip'];

// rows — строки vacancies, since — llm.shadow_since. Время карточки — card_at (пишет W2), у строк до этапа 5 — createdAt
function shadowStats(rows, since = '') {
  const from = Date.parse(since) || 0;
  const pairs = rows.filter(
    (r) =>
      SHADOW_DECISIONS.includes(r.my_decision) &&
      SHADOW_DECISIONS.includes(r.decision) &&
      (Date.parse(r.card_at || r.createdAt) || 0) >= from,
  );
  return { since: from ? since : '', pairs: pairs.length, agree: pairs.filter((r) => r.my_decision === r.decision).length };
}

// «🧪 Теневой режим с 19.10: 12/50, совпало 9 (75%)»
function shadowLine({ since, pairs, agree }) {
  const from = since ? ` с ${localDate(since)}` : '';
  const share = pairs ? `, совпало ${agree} (${Math.round((agree / pairs) * 100)}%)` : '';
  return `🧪 Теневой режим${from}: ${pairs}/${SHADOW_GOAL}${share}`;
}
