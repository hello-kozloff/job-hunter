// Запуск официального claude -p на один запрос n8n. Только текст: без инструментов (CLI оставляет лишь StructuredOutput
// для --json-schema), MCP, slash-команд и истории сессий; системный промпт — файлом (строка argv ≤ 128 КБ), задание —
// через stdin. Ответ — событиями stream-json (src/stream.mjs): лимит и сбой входа видны до итога — процесс убиваем
// сразу, не дожидаясь повторов CLI.
import { spawn as nodeSpawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { feed, newRun, outcome } from './stream.mjs';

export function cliArgs({ model, effort, systemFile, schema, maxTurns = 4 }) {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--effort', effort,
    '--system-prompt-file', systemFile,
    ...(schema ? ['--json-schema', JSON.stringify(schema)] : []),
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--permission-prompts', 'none',
    '--max-turns', String(maxTurns),
  ];
}

// Env процесса — только белый список: ANTHROPIC_API_KEY и ANTHROPIC_AUTH_TOKEN важнее OAuth-токена (CLI ушёл бы на
// API-ключ), ключ Gemini процессу не нужен. Повторов CLI — два, а не десять: лимит и вход разбираем сами
export function cliEnv(env, { token, configDir }) {
  return {
    PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: env.HOME ?? '/home/node',
    TZ: env.TZ ?? 'UTC',
    LANG: env.LANG ?? 'C.UTF-8',
    CLAUDE_CODE_OAUTH_TOKEN: token,
    ...(configDir && { CLAUDE_CONFIG_DIR: configDir }),
    DISABLE_AUTOUPDATER: '1',
    DISABLE_UPDATES: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_MAX_RETRIES: '2',
    API_TIMEOUT_MS: '120000',
  };
}

// req: { model, effort, system, user, schema }. Итог — outcome() из src/stream.mjs
export async function runClaude(req, { token, timeoutMs, signal, workDir = '/work', isolate = true, tz = 'UTC', spawn = nodeSpawn, env = process.env, bin = 'claude' }) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-'));
  const systemFile = join(dir, 'system.txt');
  writeFileSync(systemFile, req.system ?? '');
  const configDir = isolate ? join(dir, 'config') : undefined;
  if (configDir) mkdirSync(configDir);

  const run = newRun();
  let killed = null;
  let stderr = '';
  let child;
  try {
    child = spawn(bin, cliArgs({ model: req.model, effort: req.effort, systemFile, schema: req.schema }), {
      cwd: workDir,
      env: cliEnv(env, { token, configDir }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    return outcome(run, { exitCode: -1, stderr: e.message, schema: Boolean(req.schema), tz });
  }
  const kill = (why) => {
    if (killed) return;
    killed = why;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  };
  const timer = setTimeout(() => kill('timeout'), Math.max(1000, timeoutMs));
  const onAbort = () => kill('aborted');
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });

  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const lines = createInterface({ input: child.stdout });
  const linesClosed = once(lines, 'close').catch(() => {});
  lines.on('line', (line) => {
    // Лимит или вход: повторы CLI ничего не дадут — сразу на выход, вызов заберёт запасной Gemini
    if (feed(run, line) === 'fatal') kill('fatal');
  });
  child.stdin.on('error', () => {}); // процесс уже вышел — EPIPE не ошибка запроса
  child.stdin.end(req.user ?? '');

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', (e) => {
      stderr += e.message;
      resolve(-1);
    });
  });
  await linesClosed; // последняя строка stdout (итог) разобрана
  clearTimeout(timer);
  signal?.removeEventListener('abort', onAbort);
  rmSync(dir, { recursive: true, force: true });
  return outcome(run, { killed: killed === 'fatal' ? null : killed, exitCode, stderr, schema: Boolean(req.schema), tz });
}
