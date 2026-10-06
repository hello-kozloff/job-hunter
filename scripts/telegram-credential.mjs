#!/usr/bin/env node
// Печатает в stdout JSON credential «Telegram bot» для `n8n import:credentials`.
// Токен берётся из .env (TG_BOT_TOKEN). n8n при импорте шифрует его ключом N8N_ENCRYPTION_KEY.
// Используется только через pipe в scripts/deploy.sh — на диск хоста токен не пишется.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    }),
);

const token = env.TG_BOT_TOKEN;
if (!token) {
  console.error('TG_BOT_TOKEN не задан в .env');
  process.exit(1);
}

process.stdout.write(
  JSON.stringify([{ id: 'jobHunterTgBot01', name: 'Telegram bot', type: 'telegramApi', data: { accessToken: token } }]),
);
