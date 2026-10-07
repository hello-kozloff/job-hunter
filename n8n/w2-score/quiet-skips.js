// W2 · Quiet skips — теневой режим выключен (⚙️ → 🤖 Нейросеть): skip без карточки (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Ветка ниже карточек.
// Вход: «Parse verdict»; «Settings». Выход: строки для «Save quiet skips»: status = skipped без my_decision —
// решение нейросети, пользователь вакансию не видел (она есть в меню на вкладке ❌ и в итоге «🔴 N без карточек»).

// @include n8n/shared/settings.js

if (loadSettings($('Settings').all())['llm.shadow']) return [];
const now = new Date().toISOString();
return $('Parse verdict')
  .all()
  .map((i) => i.json)
  .filter((r) => r.outcome === 'scored' && r.decision === 'skip')
  .map((r) => ({
    json: {
      id: r.id,
      decision: r.decision,
      llm_reason: r.llm_reason,
      llm_model: r.llm_model,
      prompt_v: r.prompt_v ?? '',
      status: 'skipped',
      card_at: now,
    },
  }));
