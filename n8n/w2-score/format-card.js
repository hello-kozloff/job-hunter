// W2 · Format card — карточки вакансий для Telegram (Parse Mode = HTML).
// Нода: Code, режим «Run Once for All Items».
// Вход: строки из «Parse verdict»; карточка — только для outcome = scored.
// Выход: { id, text, silent, decision, llm_reason, llm_model } → «Send card» с кнопками ✅ / 🤔 / ❌.
// Теневой режим: карточка приходит на каждую оценённую вакансию, включая skip.
// Тихие часы: с 23:00 до 09:00 по Таиланду (UTC+7) карточки приходят без звука.

// @include n8n/shared/card.js

const thaiHour = (new Date().getUTCHours() + 7) % 24;
const silent = thaiHour >= 23 || thaiHour < 9;

return $input
  .all()
  .map((i) => i.json)
  .filter((r) => r.outcome === 'scored')
  .map((r) => ({
    json: {
      id: r.id,
      text: cardText(r),
      silent,
      decision: r.decision,
      llm_reason: r.llm_reason,
      llm_model: r.llm_model,
    },
  }));
