#!/usr/bin/env node
// Деплой в локальный n8n: сборка workflow, credentials из .env, импорт и публикация, перезапуск (scripts/lib/deploy.mjs).
//
//   node scripts/deploy.mjs             импорт всех workflow + публикация рабочих (расписания включены)
//   node scripts/deploy.mjs --paused    то же, но W8 Clock и W6 остаются выключенными (сбор и сводка не работают)
//   node scripts/deploy.mjs --applier   ещё и пересобрать и перезапустить робота-отклика (после конца текущего действия);
//                                       смена APPLY_LIVE / APPLIER_FAKE / VNC_PASSWORD / USER_TZ в .env — тоже так
//
// Владелец репозитория деплоит через scripts/deploy.sh — там ещё проверка ветки git flow (docs/git-flow.md).
// Работает и на Windows: только Node и Docker, без bash.
import { deploy } from './lib/deploy.mjs';

const flags = new Set(process.argv.slice(2));
const known = new Set(['--paused', '--applier', '--publish']);
const unknown = [...flags].filter((f) => !known.has(f));
if (unknown.length) {
  console.error(`Неизвестный флаг: ${unknown.join(' ')}`);
  process.exit(2);
}
try {
  await deploy({ paused: flags.has('--paused'), applier: flags.has('--applier') });
  console.log('✅ n8n обновлён и отвечает');
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
