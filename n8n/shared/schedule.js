// Расписание сбора W1 по Москве (UTC+3, без перехода на летнее время). С 07.10.2026 задаётся в боте
// (⚙️ Настройки → 🕐 Сбор, n8n/shared/settings.js → scheduleFrom), сбор запускают «часы» W8 Clock.
// sch = { dayFrom, dayTo, dayEvery, nightEvery, paused }: днём [dayFrom, dayTo) — каждые dayEvery мин, ночью — каждые
// nightEvery мин (0 — ночью не собирать). Слоты выровнены по полуночи МСК, шаг сетки — 15 мин.
// По умолчанию (решение пользователя 07.10.2026) — 29 сборов в сутки: днём 07:00–17:30 каждые 30 мин,
// ночью 18, 20, 22, 00, 02, 04, 06.
// Общий код W1 «Score job», W6 «Summary», W7 «Render», W8 «Due»: строка «// @include n8n/shared/schedule.js».

const COLLECT_STEP = 15 * 60 * 1000;
const DEFAULT_SCHEDULE = { dayFrom: 7, dayTo: 18, dayEvery: 30, nightEvery: 120, paused: false };

// Момент t (мс, кратен 15 мин) — сбор по расписанию?
function isCollectSlot(t, sch = DEFAULT_SCHEDULE) {
  if (sch.paused) return false;
  const msk = new Date(t + 3 * 3600 * 1000);
  const hour = msk.getUTCHours();
  const every = hour >= sch.dayFrom && hour < sch.dayTo ? sch.dayEvery : sch.nightEvery;
  return every > 0 && (hour * 60 + msk.getUTCMinutes()) % every === 0;
}

// Сколько сборов по расписанию в промежутке (from, to]
function countCollectSlots(from, to, sch = DEFAULT_SCHEDULE) {
  let n = 0;
  for (let t = Math.floor(from / COLLECT_STEP) * COLLECT_STEP + COLLECT_STEP; t <= to; t += COLLECT_STEP) {
    if (isCollectSlot(t, sch)) n++;
  }
  return n;
}

// Ближайший сбор по расписанию после момента t; null — на паузе
function nextCollect(t, sch = DEFAULT_SCHEDULE) {
  if (sch.paused) return null;
  let s = Math.floor(t / COLLECT_STEP) * COLLECT_STEP + COLLECT_STEP;
  for (let i = 0; i < 2 * 96; i++, s += COLLECT_STEP) if (isCollectSlot(s, sch)) return s;
  return null;
}

// Сборов в сутки по расписанию
const collectsPerDay = (sch = DEFAULT_SCHEDULE) => countCollectSlots(0, 24 * 3600 * 1000, { ...sch, paused: false });

// Расписание словами: «днём 07–18 МСК каждые 30 мин, ночью каждые 2 ч»
function describeSchedule(sch = DEFAULT_SCHEDULE) {
  const every = (m) => (m % 60 ? `${m} мин` : `${m / 60} ч`);
  const pad = (n) => String(n).padStart(2, '0');
  const night = sch.nightEvery > 0 ? `ночью каждые ${every(sch.nightEvery)}` : 'ночью не собирать';
  return `днём ${pad(sch.dayFrom)}–${pad(sch.dayTo)} МСК каждые ${every(sch.dayEvery)}, ${night}`;
}

// Расписание стража healthchecks.io: OnCalendar (строка дня и строка ночи) и запас (grace, с)
function onCalendar(sch = DEFAULT_SCHEDULE) {
  const pad = (n) => String(n).padStart(2, '0');
  const minutes = [];
  for (let m = 0; m < 60; m += Math.min(sch.dayEvery, 60)) minutes.push(pad(m));
  const lines = [`${pad(sch.dayFrom)}..${pad(sch.dayTo - 1)}:${minutes.join(',')} Europe/Moscow`];
  if (sch.nightEvery > 0) {
    const hours = [];
    for (let h = 0; h < 24; h++) {
      if ((h < sch.dayFrom || h >= sch.dayTo) && (h * 60) % sch.nightEvery === 0) hours.push(pad(h));
    }
    if (hours.length) lines.push(`${hours.join(',')}:00 Europe/Moscow`);
  }
  return { schedule: lines.join('\n'), grace: (sch.dayEvery + 20) * 60 };
}
