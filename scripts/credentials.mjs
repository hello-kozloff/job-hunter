#!/usr/bin/env node
// Печатает в stdout JSON credentials для `n8n import:credentials` — те, чьи ключи есть в .env:
//   TG_BOT_TOKEN   → «Telegram bot» (бот: сообщения, карточки, кнопки)
//   GEMINI_API_KEY → «Gemini»       (оценка вакансий, W2)
//   ANTHROPIC_API_KEY → «Claude»    (запасная нейросеть, LLM_PROVIDER=claude)
//   HC_API_KEY     → «healthchecks API» (бот обновляет расписание стража при смене расписания сбора, W7)
//   APPLIER_TOKEN  → «Applier» (робот-отклик, этап 6: W6, W7, W9 ходят в его API с заголовком X-Applier-Token)
// n8n при импорте шифрует ключи N8N_ENCRYPTION_KEY. Используется только через pipe в scripts/deploy.sh —
// на диск хоста ключи не пишутся.
import { readEnv } from './lib/env.mjs';

const env = readEnv();

const credentials = [
  env.TG_BOT_TOKEN && {
    id: 'jobHunterTgBot01',
    name: 'Telegram bot',
    type: 'telegramApi',
    data: { accessToken: env.TG_BOT_TOKEN },
  },
  env.GEMINI_API_KEY && {
    id: 'jobHunterGemini1',
    name: 'Gemini',
    type: 'googlePalmApi',
    data: { host: 'https://generativelanguage.googleapis.com', apiKey: env.GEMINI_API_KEY },
  },
  env.ANTHROPIC_API_KEY && {
    id: 'jobHunterClaude1',
    name: 'Claude',
    type: 'anthropicApi',
    data: { apiKey: env.ANTHROPIC_API_KEY, url: 'https://api.anthropic.com' },
  },
  // Ключ проекта healthchecks.io (Settings → API Access → read-write key) — заголовок X-Api-Key
  env.HC_API_KEY && {
    id: 'jobHunterHcApi01',
    name: 'healthchecks API',
    type: 'httpHeaderAuth',
    data: { name: 'X-Api-Key', value: env.HC_API_KEY },
  },
  env.APPLIER_TOKEN && {
    id: 'jobHunterApplier',
    name: 'Applier',
    type: 'httpHeaderAuth',
    data: { name: 'X-Applier-Token', value: env.APPLIER_TOKEN },
  },
].filter(Boolean);

if (!credentials.length) {
  console.error('В .env нет ни одного ключа: TG_BOT_TOKEN, GEMINI_API_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}
console.error(`credentials: ${credentials.map((c) => c.name).join(', ')}`);
process.stdout.write(JSON.stringify(credentials));
