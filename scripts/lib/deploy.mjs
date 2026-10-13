// Деплой в локальный n8n (docker compose) — на Node, чтобы работал и на Windows без bash (13.10.2026).
// Общий код scripts/deploy.mjs (scripts/deploy.sh — обёртка с проверкой ветки git flow) и мастера scripts/install.mjs.
//
// Шаги — как в прежнем scripts/deploy.sh:
//   1. сборка workflow из n8n/**/*.js;
//   2. туннель и профили compose по .env (NGROK_DOMAIN → WEBHOOK_URL, tunnel; APPLIER_TOKEN → applier);
//   3. docker compose up (n8n, ngrok при туннеле); робот — только с applier: true (дождаться конца действия, пересобрать);
//   4. credentials из .env — через pipe прямо в контейнер, на диск хоста ключи не пишутся;
//   5. импорт workflow (снимает публикацию со всех) и публикация рабочих:
//      W4 (тревоги), W5 (письма), W7 (меню), W1 (сбор), W2 (оценка), W9 (робот), W11 (профиль) — всегда: в n8n 2.42
//      неопубликованный Error workflow и вызываемый (Execute Workflow) не запускаются;
//      W8 («часы» сбора и сводки) и W6 (сводка) — если не paused; W3 (кнопки Telegram) — если есть туннель;
//   6. перезапуск n8n (CLI-публикацию запущенный n8n видит только после него) и ожидание /healthz.
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, readEnv, local } from './env.mjs';

const ALWAYS = ['jobHunterW4Error', 'jobHunterW5Lettr', 'jobHunterW7Menu1', 'jobHunterW1Colle', 'jobHunterW2Score', 'jobHunterW9Robot', 'jobHunterW11Prof'];
const SCHEDULED = ['jobHunterW8Clock', 'jobHunterW6Summ1'];
const TELEGRAM = 'jobHunterW3Teleg';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Свежий контейнер n8n первые секунды держит базу SQLite (миграции, VACUUM при старте): CLI-команды в нём падают
// с SQLITE_BUSY (13.10.2026). Импорт и публикация повторяемы — пробуем ещё раз
async function retry(label, fn, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`⏳ ${label}: n8n ещё занят (${String(e.message).split('\n')[0].slice(0, 80)}) — повтор через 10 с`);
      await sleep(10000);
    }
  }
}

// Команда с выводом в консоль; ошибка — исключение с кодом выхода
function sh(cmd, args, { quiet = false, input } = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, stdio: [input === undefined ? 'inherit' : 'pipe', quiet ? 'pipe' : 'inherit', 'inherit'], input, encoding: 'utf8' });
}
const node = (script, args = [], opts) => sh(process.execPath, [join(ROOT, script), ...args], opts);

// stdout одной команды → stdin другой (credentials → n8n import:credentials)
function pipe([cmd1, args1], [cmd2, args2]) {
  return new Promise((resolve, reject) => {
    const a = spawn(cmd1, args1, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    const b = spawn(cmd2, args2, { cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'] });
    a.stdout.pipe(b.stdin);
    let failed = false;
    a.on('exit', (code) => {
      if (code) failed = true;
    });
    b.on('exit', (code) => (code || failed ? reject(new Error(`${cmd1} | ${cmd2}: код ${code}`)) : resolve()));
  });
}

async function waitHealthz(port, seconds = 60) {
  for (let i = 0; i < seconds / 2; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status === 200) return;
    } catch {
      // ещё стартует
    }
    await sleep(2000);
  }
  throw new Error(`n8n не ответил на /healthz за ${seconds} с`);
}

// Робот занят откликом — ждём (до 5 мин), чтобы не оборвать его
async function waitApplierIdle(port, token) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { 'X-Applier-Token': token }, signal: AbortSignal.timeout(5000) });
      if (!(await res.json()).busy) return;
    } catch {
      return; // робот не отвечает — ждать нечего
    }
    console.log('Робот занят — жду, пока закончит действие…');
    await sleep(5000);
  }
}

export async function deploy({ paused = false, applier = false } = {}) {
  node('scripts/build-workflows.mjs');

  let env = readEnv();
  if (env.NGROK_DOMAIN || env.APPLIER_TOKEN) node('scripts/n8n-api.mjs', ['tunnel-env']);
  env = readEnv();
  const { n8nContainer, n8nPort, applierPort } = local(env);
  const tunnel = Boolean(env.NGROK_DOMAIN);

  sh('docker', ['compose', 'up', '-d', '--wait', 'n8n', ...(tunnel ? ['ngrok'] : [])]);
  await waitHealthz(n8nPort, 120);

  if (applier) {
    if (!env.APPLIER_TOKEN) throw new Error('Для робота нужен APPLIER_TOKEN в .env (openssl rand -hex 24) — см. .env.example');
    await waitApplierIdle(applierPort, env.APPLIER_TOKEN);
    sh('docker', ['compose', 'build', 'applier']);
    sh('docker', ['compose', 'up', '-d', '--wait', 'applier']);
  }

  await retry('credentials', () =>
    pipe(
      [process.execPath, [join(ROOT, 'scripts/credentials.mjs')]],
      // set -e: ошибка импорта — ненулевой код выхода, иначе повтор не сработал бы
      ['docker', ['exec', '-i', n8nContainer, 'sh', '-c', 'cat > /tmp/cred.json && n8n import:credentials --input=/tmp/cred.json; code=$?; rm -f /tmp/cred.json; exit $code']],
    ),
  );

  // docker cp кладёт файлы от root — удалять тоже от root
  sh('docker', ['exec', '-u', 'root', n8nContainer, 'rm', '-rf', '/tmp/workflows']);
  sh('docker', ['cp', join(ROOT, 'n8n/workflows'), `${n8nContainer}:/tmp/workflows`]);
  await retry('импорт workflow', () => sh('docker', ['exec', n8nContainer, 'n8n', 'import:workflow', '--separate', '--input=/tmp/workflows']));

  const publish = [...ALWAYS, ...(paused ? [] : SCHEDULED), ...(tunnel ? [TELEGRAM] : [])];
  for (const id of publish) await retry(`публикация ${id}`, () => sh('docker', ['exec', n8nContainer, 'n8n', 'publish:workflow', `--id=${id}`]));

  sh('docker', ['compose', 'restart', 'n8n']);
  await waitHealthz(n8nPort);
}
