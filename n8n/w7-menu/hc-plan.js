// W7 · HC plan — расписание сбора поменялось → обновить стража healthchecks.io через его API (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Setting change» (что поменяли), «Settings» (остальные значения).
// Выход: [{ url, body, what }] → «HC sync» (POST, ключ — credential «healthchecks API» = HC_API_KEY из .env)
//   пауза → POST …/pause (пинг после возобновления снимет паузу сам); иначе → новый OnCalendar и grace;
//   [] — поменяли не расписание или в .env нет HC_PING_URL (стража нет).

// @include n8n/shared/settings.js

// @include n8n/shared/schedule.js

const change = $('Setting change').first().json;
const uuid = String($env.HC_PING_URL ?? '').match(/([0-9a-f-]{36})\/?$/i)?.[1];
if (!change.name.startsWith('collect.') || !uuid) return [];

const s = { ...loadSettings($('Settings').all()), [change.name]: change.value };
const sch = scheduleFrom(s);
const url = `https://healthchecks.io/api/v3/checks/${uuid}`;
if (sch.paused) return [{ json: { url: `${url}/pause`, body: {}, what: 'pause' } }];
const { schedule, grace } = onCalendar(sch);
return [{ json: { url, body: { schedule, tz: 'Europe/Moscow', grace }, what: 'schedule' } }];
