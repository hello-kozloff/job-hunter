// W2 · Format card — карточки вакансий для Telegram (Parse Mode = HTML).
// Нода: Code, режим «Run Once for All Items».
// Вход: строки из «Parse verdict»; карточка — только для outcome = scored.
// Выход: { id, text, silent, decision, llm_reason, llm_model } → «Send card» с кнопками ✅ / 🤔 / ❌.
// Теневой режим (настройка llm.shadow, ⚙️ → 🤖 Нейросеть): карточка приходит на каждую оценённую вакансию,
// включая skip. Выключен — skip без карточки: строку закрывает «Quiet skips», в итоге — «🔴 N без карточек».
// Тихие часы: с 23:00 до 09:00 по местному карточки приходят без звука (n8n/shared/time.js).

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

const shadow = loadSettings($('Settings').all())['llm.shadow'];

const silent = quietHours();

return $input
  .all()
  .map((i) => i.json)
  .filter((r) => r.outcome === 'scored' && (shadow || r.decision !== 'skip'))
  .map((r) => ({
    json: {
      id: r.id,
      text: cardText(r),
      silent,
      decision: r.decision,
      llm_reason: r.llm_reason,
      llm_model: r.llm_model,
      prompt_v: r.prompt_v ?? '',
    },
  }));
