#!/usr/bin/env node
// Мастер установки Job Hunter (13.10.2026, docs/onboarding.md): одна команда — и система работает, дальше всё в Telegram.
//
//   node scripts/install.mjs                      установка или обновление (повторный запуск безопасен)
//   node scripts/install.mjs --project jh-test --port 5690
//                                                 вторая установка рядом с первой (свои контейнеры, тома и порт)
//
// Что делает:
//   1. проверяет Node 22+ и Docker;
//   2. .env: ключ шифрования, часовой пояс компьютера, имя проекта и порт — сам;
//   3. спрашивает токен бота (@BotFather) → проверяет; привязывает чат: ссылка t.me/<бот>?start=<код> → ловит /start;
//   4. спрашивает ключ Gemini (и по желанию Claude) → пробный запрос;
//   5. спрашивает токен и домен ngrok (кнопки Telegram приходят через туннель);
//   6. запускает n8n, создаёт владельца, таблицы, деплоит workflow, ключ API для сводки;
//   7. бот присылает приветствие: «пришли резюме PDF».
// Заполненное в .env не спрашивает. Работает на Mac, Linux и Windows (PowerShell или WSL): только Node и Docker.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ROOT, ENV_PATH, readEnv, setEnv, local } from './lib/env.mjs';
import { deploy } from './lib/deploy.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const rl = createInterface({ input: stdin, output: stdout });
// Ввод закрыт (ответы пришли через pipe и кончились) — считаем ответом «Enter», а не падаем
const ask = async (q) => {
  try {
    return (await rl.question(q)).trim();
  } catch {
    return '';
  }
};
const say = (s = '') => console.log(s);
const step = (n, title) => say(`\n${n}. ${title}`);
const fail = (msg) => {
  say(`\n❌ ${msg}`);
  rl.close();
  process.exit(1);
};
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const node = (script, a = [], inherit = false) =>
  execFileSync(process.execPath, [join(ROOT, script), ...a], { cwd: ROOT, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

say('🧭 Мастер установки Job Hunter');

// ---------- 1. Проверки ----------
step(1, 'Проверяю окружение');
if (Number(process.versions.node.split('.')[0]) < 22) fail(`Нужен Node.js 22 или новее, сейчас ${process.versions.node}: https://nodejs.org`);
try {
  run('docker', ['info', '--format', '{{.ServerVersion}}']);
  run('docker', ['compose', 'version']);
} catch {
  fail('Docker не запущен или не установлен. Установи Docker Desktop (https://www.docker.com/products/docker-desktop) и запусти его.');
}
say('   ✓ Node и Docker на месте');

// ---------- 2. .env ----------
step(2, 'Готовлю .env');
if (!existsSync(ENV_PATH)) {
  copyFileSync(join(ROOT, '.env.example'), ENV_PATH);
  say('   ✓ .env создан из .env.example');
}
let env = readEnv();
const defaults = {};
if (!env.N8N_ENCRYPTION_KEY) defaults.N8N_ENCRYPTION_KEY = randomBytes(32).toString('hex');
if (!env.USER_TZ) defaults.USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
if (!env.COMPOSE_PROJECT_NAME) defaults.COMPOSE_PROJECT_NAME = flag('--project') || 'job-hunter';
if (!env.N8N_PORT) defaults.N8N_PORT = flag('--port') || '5678';
if (Object.keys(defaults).length) setEnv(defaults, 'Мастер установки (scripts/install.mjs)');
env = readEnv();
say(`   ✓ часовой пояс ${env.USER_TZ}, проект ${env.COMPOSE_PROJECT_NAME}, порт ${env.N8N_PORT}`);
if (defaults.N8N_ENCRYPTION_KEY) say('   ⚠️ В .env появился N8N_ENCRYPTION_KEY — сохрани его в менеджер паролей: без него ключи в n8n не расшифровать');

// ---------- 3. Telegram ----------
step(3, 'Telegram-бот');
const tg = (token, method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());
let bot;
for (;;) {
  const token = env.TG_BOT_TOKEN || (await ask('   Создай бота у @BotFather (/newbot) и вставь его токен: '));
  const me = await tg(token, 'getMe').catch(() => null);
  if (me?.ok) {
    bot = me.result;
    if (token !== env.TG_BOT_TOKEN) setEnv({ TG_BOT_TOKEN: token }, 'Токен бота (@BotFather)');
    env = readEnv();
    break;
  }
  say('   ✗ Telegram не принял токен — проверь и вставь ещё раз');
  env.TG_BOT_TOKEN = '';
}
say(`   ✓ бот @${bot.username}`);
if (!env.TG_CHAT_ID) {
  // Вебхук мешает getUpdates (повторная установка) — снимаем; деплой поставит его снова
  await tg(env.TG_BOT_TOKEN, 'deleteWebhook', { drop_pending_updates: false });
  const code = randomBytes(3).toString('hex');
  say(`   Открой https://t.me/${bot.username}?start=${code} и нажми «Запустить» (Start)`);
  let chatId;
  let offset = 0;
  const until = Date.now() + 10 * 60 * 1000;
  while (!chatId && Date.now() < until) {
    const updates = await tg(env.TG_BOT_TOKEN, 'getUpdates', { offset, timeout: 30, allowed_updates: ['message'] }).catch(() => null);
    for (const u of updates?.result ?? []) {
      offset = u.update_id + 1;
      if (String(u.message?.text ?? '').trim() === `/start ${code}`) chatId = String(u.message.chat.id);
    }
  }
  if (!chatId) fail('За 10 минут /start не пришёл. Запусти мастер ещё раз.');
  // Подтвердить прочитанные обновления, чтобы они не пришли в n8n
  await tg(env.TG_BOT_TOKEN, 'getUpdates', { offset, timeout: 0 });
  setEnv({ TG_CHAT_ID: chatId }, 'Твой чат с ботом');
  env = readEnv();
  await tg(env.TG_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: '✅ Бот привязан к этому чату. Разворачиваю систему — пара минут…' });
}
say(`   ✓ чат привязан (${env.TG_CHAT_ID})`);

// ---------- 4. Нейросеть ----------
step(4, 'Нейросеть');
say('   Gemini: бесплатный ключ — https://aistudio.google.com/apikey');
say('   Важно: из России Gemini не работает (Google блокирует), а Claude запрещён правилами Anthropic. В ЕС, Великобритании');
say('   и Швейцарии бесплатного Gemini нет — нужен платный аккаунт или Claude.');
for (;;) {
  const key = env.GEMINI_API_KEY || (await ask('   Ключ Gemini (Enter — пропустить, если будет Claude): '));
  if (!key) break;
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Ответь одним словом: ок' }] }], generationConfig: { maxOutputTokens: 5 } }),
  }).catch((e) => ({ status: 0, json: async () => ({ error: { message: e.message } }) }));
  const body = await res.json().catch(() => ({}));
  if (res.status === 200) {
    if (key !== env.GEMINI_API_KEY) setEnv({ GEMINI_API_KEY: key }, 'Нейросеть (W2 оценка, W5 письма, W11 разбор резюме)');
    env = readEnv();
    say('   ✓ Gemini отвечает');
    break;
  }
  const message = String(body?.error?.message ?? `HTTP ${res.status}`);
  if (/location is not supported/i.test(message)) say('   ✗ Gemini недоступен из твоей страны. Нужна другая сеть или ключ Claude (следующий вопрос).');
  else say(`   ✗ Gemini не принял ключ: ${message.slice(0, 160)}`);
  env.GEMINI_API_KEY = '';
  if ((await ask('   Попробовать другой ключ? [Y/n] ')).toLowerCase() === 'n') break;
}
if (!env.ANTHROPIC_API_KEY) {
  const claude = await ask('   Ключ Claude (https://console.anthropic.com, платный; Enter — пропустить): ');
  if (claude) setEnv({ ANTHROPIC_API_KEY: claude }, 'Запасная нейросеть Claude (⚙️ → 🤖 Нейросеть)');
  env = readEnv();
}
if (!env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY) fail('Без нейросети системе не разобрать резюме и не оценить вакансии. Нужен ключ Gemini или Claude.');
if (!env.GEMINI_API_KEY) say('   ⚠️ Без Gemini: после установки переключи нейросеть на Claude — ⚙️ Настройки → 🤖 Нейросеть');

// ---------- 5. ngrok ----------
step(5, 'Туннель для кнопок Telegram (ngrok)');
if (!env.NGROK_AUTHTOKEN || !env.NGROK_DOMAIN) {
  say('   Бесплатный аккаунт: https://dashboard.ngrok.com → Your Authtoken и Domains (один бесплатный домен).');
  const token = env.NGROK_AUTHTOKEN || (await ask('   ngrok Authtoken: '));
  let domain = env.NGROK_DOMAIN || (await ask('   ngrok домен (например name.ngrok-free.dev): '));
  domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) fail(`Домен «${domain}» не похож на домен ngrok — запусти мастер ещё раз`);
  setEnv({ NGROK_AUTHTOKEN: token, NGROK_DOMAIN: domain }, 'Туннель ngrok для кнопок Telegram (W3)');
  env = readEnv();
}
say(`   ✓ https://${env.NGROK_DOMAIN}`);

// ---------- 6. Запуск ----------
step(6, 'Запускаю систему (первый раз — несколько минут)');
const { n8nPort } = local(env);
try {
  execFileSync('docker', ['compose', 'up', '-d', '--wait', 'n8n'], { cwd: ROOT, stdio: 'inherit' });
} catch {
  fail('n8n не запустился — смотри вывод docker compose выше');
}
// Контейнер «здоров» раньше, чем n8n принимает запросы (миграции при первом старте) — ждём /healthz
for (let i = 0; ; i++) {
  const ok = await fetch(`http://127.0.0.1:${n8nPort}/healthz`).then((r) => r.status === 200, () => false);
  if (ok) break;
  if (i > 90) fail('n8n не отвечает на /healthz 3 минуты — смотри docker compose logs n8n');
  await sleep(2000);
}
if (!env.N8N_OWNER_PASSWORD) {
  const email = (await ask('   Почта для входа в интерфейс n8n (Enter — owner@example.com): ')) || 'owner@example.com';
  node('scripts/n8n-api.mjs', ['setup-owner', email], true);
  env = readEnv();
}
node('scripts/n8n-api.mjs', ['migrate'], true);
try {
  await deploy();
} catch (e) {
  fail(`Деплой не прошёл: ${e.message}`);
}
// Ключ публичного API n8n для утренней сводки (W6) — сразу в n8n, на диск не пишется
await new Promise((resolve) => {
  const a = spawn(process.execPath, [join(ROOT, 'scripts/n8n-api.mjs'), 'api-key'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  const b = spawn('docker', ['exec', '-i', local(env).n8nContainer, 'sh', '-c', 'cat > /tmp/c.json && n8n import:credentials --input=/tmp/c.json; rm -f /tmp/c.json'], {
    cwd: ROOT,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  a.stdout.pipe(b.stdin);
  b.on('exit', resolve);
});
say('   ✓ n8n работает, workflow опубликованы');

// ---------- 7. Приветствие ----------
step(7, 'Приветствие в Telegram');
await sleep(2000);
try {
  node('scripts/n8n-api.mjs', ['run', 'jobHunterW7Menu1']);
  say('   ✓ бот прислал приветствие');
} catch {
  say('   ⚠️ приветствие не ушло — напиши боту /start');
}
rl.close();

say(`
✅ Готово. Дальше — в Telegram: пришли боту резюме в PDF (hh: «Мои резюме» → резюме → «Скачать» → PDF).

Интерфейс n8n: http://localhost:${n8nPort} (логин и пароль — в .env: N8N_OWNER_EMAIL, N8N_OWNER_PASSWORD).
Обновить систему: git pull && node scripts/install.mjs
Компьютер должен быть включён и не спать — иначе сборы пропускаются (после пробуждения — один догоняющий).
Робот-отклик (по желанию) — README, раздел «Робот-отклик».`);
