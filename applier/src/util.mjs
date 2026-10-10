// Мелкие общие функции робота. Без побочных эффектов при импорте — модуль используют и тесты на Mac.
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const rand = (min, max) => min + Math.random() * (max - min);
// Пауза «как человек»: случайная длительность в миллисекундах
export const pause = (min, max) => sleep(rand(min, max));

// 2026-10-11T07:05:09.123Z → 20261011-070509 (имена папок разведки и скриншотов)
export const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// «День» робота для лимита откликов — с 09:00 по Таиланду (02:00 UTC), решение пользователя 10.10.2026:
// отложенные на завтра отклики уходят, когда тихие часы (23–09) закончились
export function robotDayStart(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2));
  if (start > now) start.setUTCDate(start.getUTCDate() - 1);
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
