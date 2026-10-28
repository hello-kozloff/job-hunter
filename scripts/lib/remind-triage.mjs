// Разовая сортировка кандидатов в напоминание (6.3, 28.10.2026, docs/stages/stage-6.md → 6.3) по переписи «Откликов»
// hh: что hh уже знает про отклик — просмотрен, приглашение, отказ, закрыта, переписку отключили — пишется итогом
// напоминания без визитов робота. Команда — node scripts/n8n-api.mjs remind-triage <topics.json> [--dry]; здесь —
// логика без сети и без n8n. topics.json пишет робот: node scripts/applier.mjs recon --negotiations (поля статуса —
// applier/src/hh/state.mjs → topicState). «Не просмотрен» остаётся кандидатом: решат страница вакансии и чат (у hh
// viewedByOpponent — видел ли работодатель последнее сообщение: после нового сообщения соискателя он снова false).

// Итоги напоминания, после которых строку не трогаем (n8n/shared/remind.js → REMIND_FINAL)
export const FINAL = ['sent', 'already', 'viewed', 'invited', 'rejected', 'wrote', 'closed', 'archived', 'no_topic'];

// Топик отклика → итог напоминания или null (кандидат). Порядок — как у робота (state.mjs → remindFromTopic)
export function triageOutcome(t) {
  if (t.archived || t.closed) return { outcome: 'archived', note: 'вакансия закрыта' };
  if (t.declined) return { outcome: 'rejected', note: 'вы отказались от отклика' };
  if (t.lastState === 'DISCARD') return { outcome: 'rejected', note: 'отказ работодателя' };
  if (t.lastState !== 'RESPONSE') return { outcome: 'invited', note: `статус на hh: ${t.lastState}` };
  if (t.viewed) return { outcome: 'viewed', note: 'работодатель уже открыл отклик' };
  if (t.chatWrite === 'DISABLED' || t.inbox === 'DISABLED_BY_EMPLOYER') return { outcome: 'closed', note: 'работодатель отключил переписку' };
  if (t.chatArchived) return { outcome: 'closed', note: 'чат отклика в архиве' };
  return null;
}

// rows — строки vacancies, topics — отклики hh с полями статуса (без них — перепись старая: пропускаем).
// mark — итог по hh; keep — кандидат (пишем только hh_chat_id); missing — в «Откликах» нет (удалён на hh или ещё не
// виден): решит робот. Строки не отправленные, в очереди напоминаний или с итогом — не трогаем
export function planRemindTriage({ rows, topics }) {
  const byId = new Map(topics.filter((t) => t.lastState).map((t) => [String(t.vacancyId), t]));
  const plan = { mark: [], keep: [], missing: [] };
  for (const row of rows) {
    if (row.status !== 'applied' || row.remind_state || FINAL.includes(row.remind_result)) continue;
    const topic = byId.get(String(row.external_id));
    if (!topic) {
      plan.missing.push({ row });
      continue;
    }
    const verdict = triageOutcome(topic);
    if (verdict) plan.mark.push({ row, topic, ...verdict });
    else plan.keep.push({ row, topic });
  }
  return plan;
}

// Что записать в строку. remind_at не пишем: это не попытка робота — журнал панели 🔔 и сводка их не покажут
export const triageUpdate = (hit) => ({
  ...(hit.outcome && { remind_result: hit.outcome, remind_note: `по «Откликам» hh: ${hit.note}` }),
  ...(hit.topic.chatId && { hh_chat_id: String(hit.topic.chatId) }),
});
