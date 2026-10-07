// Расписание сбора W1 по Москве (UTC+3, без перехода на летнее время), решение пользователя 07.10.2026:
// днём 07:00–17:30 каждые 30 мин, ночью 18, 20, 22, 00, 02, 04, 06 — 29 сборов в сутки.
// Держать в синхроне с Schedule W1 в scripts/build-workflows.mjs.
// Общий код W1 «Score job» (следующий сбор), W6 «Summary» и W7 «Render»: строка «// @include n8n/shared/schedule.js».

const COLLECT_STEP = 30 * 60 * 1000;

// Момент t (мс, кратен 30 мин) — сбор по расписанию?
function isCollectSlot(t) {
  const msk = new Date(t + 3 * 3600 * 1000);
  const h = msk.getUTCHours();
  const m = msk.getUTCMinutes();
  return h >= 7 && h < 18 ? m % 30 === 0 : m === 0 && h % 2 === 0;
}

// Сколько сборов по расписанию в промежутке (from, to]
function countCollectSlots(from, to) {
  let n = 0;
  for (let t = Math.floor(from / COLLECT_STEP) * COLLECT_STEP + COLLECT_STEP; t <= to; t += COLLECT_STEP) {
    if (isCollectSlot(t)) n++;
  }
  return n;
}

// Ближайший сбор по расписанию после момента t
function nextCollect(t) {
  let s = Math.floor(t / COLLECT_STEP) * COLLECT_STEP + COLLECT_STEP;
  while (!isCollectSlot(s)) s += COLLECT_STEP;
  return s;
}
