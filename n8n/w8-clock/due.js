// W8 · Due — пора ли собирать: «часы» тикают каждые 15 мин, расписание — из настроек бота (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Settings» — строки таблицы settings.
// Static data (global): dispatchedAt — когда «часы» последний раз запустили сбор.
// Выход: [{ kind }] → «Collect» (W1, без ожидания):
//   schedule — слот наступил вовремя;
//   catchup  — слот пропущен (Mac спал): после пробуждения один догоняющий сбор, а не по одному на каждый слот;
//   [] — не пора или сбор на паузе.

// @include n8n/shared/settings.js

// @include n8n/shared/schedule.js

const sch = scheduleFrom(loadSettings($('Settings').all()));
const state = $getWorkflowStaticData('global');
const now = Date.now();
// Первый тик после деплоя смотрит на шаг назад — слот этого тика не потеряется
const since = state.dispatchedAt ?? now - COLLECT_STEP;
if (sch.paused || !countCollectSlots(since, now, sch)) return [];

state.dispatchedAt = now;
// Тик опаздывает на секунды: слот этого тика — значит вовремя
const slot = Math.floor(now / COLLECT_STEP) * COLLECT_STEP;
const kind = isCollectSlot(slot, sch) && now - slot < 5 * 60 * 1000 ? 'schedule' : 'catchup';
return [{ json: { kind } }];
