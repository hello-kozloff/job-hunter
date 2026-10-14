// W8 · Summary due — пора ли утренняя сводка W6: в 10:00 по местному, раз в день (13.10.2026, docs/onboarding.md).
// До 13.10.2026 сводку запускал cron W6 в 06:00 МСК, и после сна Mac она пропадала (CLAUDE.md §12). «Часы» тикают
// каждые 15 мин: Mac спал в 10:00 — сводка уйдёт на первом тике после пробуждения (до конца местных суток).
// Нода: Code, режим «Run Once for All Items». Вход: «Settings» — часовой пояс (n8n/shared/time.js).
// Static data (global): summaryDay — местная дата последней сводки.
// Выход: [{ kind: 'summary' }] → «Summary» (W6, без ожидания) или [] — не пора.

// @include n8n/shared/time.js

// @include n8n/shared/settings.js

const SUMMARY_HOUR = 10;
const state = $getWorkflowStaticData('global');
const now = Date.now();
const day = localDay(now);
const due = localHour(now) >= SUMMARY_HOUR;

// Первый тик после деплоя только запоминает день: если уже позже 10:00, сегодняшнюю сводку прислал прежний cron
if (state.summaryDay === undefined) {
  state.summaryDay = due ? day : '';
  return [];
}
// Профиля ещё нет — сводки нет (сводку за этот день пришлём, как только онбординг закончится и наступит 10:00)
if (!due || state.summaryDay === day || !loadSettings($('Settings').all())['profile.ready']) return [];
state.summaryDay = day;
return [{ json: { kind: 'summary' } }];
