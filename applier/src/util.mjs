// Мелкие общие функции робота. Без побочных эффектов при импорте — модуль используют и тесты на Mac.
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const rand = (min, max) => min + Math.random() * (max - min);
// Пауза «как человек»: случайная длительность в миллисекундах
export const pause = (min, max) => sleep(rand(min, max));

// 2026-10-11T07:05:09.123Z → 20261011-070509 (имена папок разведки и скриншотов)
export const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// Смещение пояса tz от UTC в минутах в момент d (Бангкок: +420)
function tzOffsetMin(d, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

// «День» робота для лимита откликов — с 09:00 по местному (решение пользователя 10.10.2026): отложенные на завтра
// отклики уходят, когда тихие часы (23–09) закончились. Пояс — компьютера (USER_TZ), как у браузера робота
export function robotDayStart(now = new Date(), tz = process.env.USER_TZ || 'Europe/Moscow') {
  const offset = tzOffsetMin(now, tz) * 60000;
  const local = new Date(now.getTime() + offset);
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 9) - offset);
  if (start > now) start.setTime(start.getTime() - 24 * 3600 * 1000);
  return start;
}

// Запись JSON через временный файл: оборванная запись не оставит битый файл
export function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

// Удалить файлы старше days дней (скриншоты, журналы)
export function prune(dir, days) {
  const limit = Date.now() - days * 24 * 3600 * 1000;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (statSync(path).mtimeMs < limit) {
        rmSync(path, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // файл уже удалили — не важно
    }
  }
  return removed;
}
