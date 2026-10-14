// W2 · First save — первый поиск после онбординга (profile.first_quiet, 14.10.2026): оценки без карточек.
// Нода: Code, режим «Run Once for All Items». Ветка ниже карточек. Вход: «Parse verdict», «Settings».
// Выход: строки для «Save first»: status = waiting без карточки (вакансия ждёт решения в 📋 Вакансии → ⏳), card_at —
// от него W6 через 3 дня пометит «⌛ устарела». skip при выключенном теневом режиме закрывает «Quiet skips».

// @include n8n/shared/settings.js

const s = loadSettings($('Settings').all());
if (!s['profile.first_quiet']) return [];
const now = new Date().toISOString();
return $('Parse verdict')
  .all()
  .map((i) => i.json)
  .filter((r) => r.outcome === 'scored' && (s['llm.shadow'] || r.decision !== 'skip'))
  .map((r) => ({
    json: {
      id: r.id,
      decision: r.decision,
      llm_reason: r.llm_reason,
      llm_model: r.llm_model,
      prompt_v: r.prompt_v ?? '',
      status: 'waiting',
      card_at: now,
    },
  }));
