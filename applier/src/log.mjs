// Журнал робота JSON-строками: stdout (docker logs) и /data/logs/ГГГГ-ММ-ДД.jsonl — хранится 30 дней (server.mjs).
// Тексты писем, cookie и токен в журнал не пишем.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';

const dir = join(config.dataDir, 'logs');
let ready = false;

export function log(event, fields = {}) {
  const at = new Date().toISOString();
  const line = JSON.stringify({ at, event, ...fields });
  console.log(line);
  try {
    if (!ready) {
      mkdirSync(dir, { recursive: true });
      ready = true;
    }
    appendFileSync(join(dir, `${at.slice(0, 10)}.jsonl`), `${line}\n`);
  } catch {
    // журнал на диске не важнее работы робота
  }
}
