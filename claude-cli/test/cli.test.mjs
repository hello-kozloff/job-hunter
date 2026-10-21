// Запуск claude -p: аргументы, белый список env, разбор потока. Сам claude подменён процессом, который проигрывает
// фикстуры stream-json. Запуск: cd claude-cli && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import { cliArgs, cliEnv, runClaude } from '../src/cli.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').trim().split('\n');

// Поддельный процесс: строки stdout с паузой; kill — остановка и выход с кодом 143
function fakeSpawn(lines, { delayMs = 5, exitCode = 0, hang = false } = {}) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter();
    let input = '';
    child.stdin = new Writable({
      write(chunk, _enc, done) {
        input += chunk;
        done();
      },
    });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    calls.push({ bin, args, opts, input: () => input });
    let stopped = false;
    const finish = (code) => {
      if (stopped) return;
      stopped = true;
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', code));
    };
    child.kill = (signal) => {
      child.killedWith = signal;
      finish(143);
    };
    (async () => {
      for (const line of lines) {
        await new Promise((r) => setTimeout(r, delayMs));
        if (stopped) return;
        child.stdout.write(`${line}\n`);
      }
      if (!hang) finish(exitCode);
    })();
    return child;
  };
  return { spawn, calls };
}

const REQ = { model: 'claude-haiku-5-5', effort: 'low', system: 'Системный промпт', user: 'Текст вакансии', schema: { type: 'object' } };

test('аргументы: только текст, схема, файл системного промпта', () => {
  const args = cliArgs({ model: 'claude-sonnet-5-5', effort: 'low', systemFile: '/tmp/x/system.txt', schema: { type: 'object' } });
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], '-p');
  assert.equal(at('--output-format'), 'stream-json');
  assert.ok(args.includes('--verbose'));
  assert.equal(at('--model'), 'claude-sonnet-5-5');
  assert.equal(at('--effort'), 'low');
  assert.equal(at('--system-prompt-file'), '/tmp/x/system.txt');
  assert.equal(at('--json-schema'), '{"type":"object"}');
  assert.equal(at('--tools'), '');
  for (const flag of ['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) assert.ok(args.includes(flag), flag);
  assert.equal(at('--permission-prompts'), 'none');
  assert.equal(cliArgs({ model: 'm', effort: 'low', systemFile: 'f' }).includes('--json-schema'), false);
});

test('env: токен подписки есть, ключей API и Gemini нет', () => {
  const env = cliEnv(
    { PATH: '/bin', HOME: '/home/node', ANTHROPIC_API_KEY: 'sk-ant-api', ANTHROPIC_AUTH_TOKEN: 'x', GEMINI_API_KEY: 'g', CLAUDE_CODE_USE_BEDROCK: '1' },
    { token: 'sk-ant-oat01-t', configDir: '/tmp/c' },
  );
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-t');
  assert.equal(env.CLAUDE_CONFIG_DIR, '/tmp/c');
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'CLAUDE_CODE_USE_BEDROCK']) assert.equal(env[key], undefined, key);
  assert.equal(env.DISABLE_AUTOUPDATER, '1');
  assert.equal(env.CLAUDE_CODE_MAX_RETRIES, '2');
});

test('успех: задание уходит в stdin, итог — ответ по схеме', async () => {
  const { spawn, calls } = fakeSpawn(fixture('ok-score.jsonl'));
  const out = await runClaude(REQ, { token: 't', timeoutMs: 5000, spawn, workDir: '/tmp' });
  assert.equal(out.kind, 'ok');
  assert.equal(out.json.decision, 'apply');
  assert.equal(calls[0].bin, 'claude');
  assert.equal(calls[0].input(), 'Текст вакансии');
  assert.equal(calls[0].opts.cwd, '/tmp');
  assert.ok(calls[0].opts.env.CLAUDE_CONFIG_DIR);
});

test('вход слетел: процесс убит на первом api_retry, не дожидаясь повторов', async () => {
  const { spawn, calls } = fakeSpawn(fixture('auth.jsonl'), { delayMs: 100 });
  const started = Date.now();
  const out = await runClaude(REQ, { token: 't', timeoutMs: 5000, spawn, workDir: '/tmp' });
  assert.equal(out.kind, 'auth');
  // убит после второй строки (≈ 200 мс), все пять строк шли бы 500 мс
  assert.ok(Date.now() - started < 400, `${Date.now() - started} мс`);
  assert.equal(calls.length, 1);
});

test('таймаут: процесс завис — убит, исход timeout', async () => {
  const { spawn } = fakeSpawn(fixture('ok-score.jsonl').slice(0, 1), { hang: true });
  const out = await runClaude(REQ, { token: 't', timeoutMs: 1000, spawn, workDir: '/tmp' });
  assert.equal(out.kind, 'timeout');
});

test('отмена: n8n закрыл соединение — процесс убит, исход aborted', async () => {
  const { spawn } = fakeSpawn(fixture('ok-letter.jsonl'), { delayMs: 50 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const out = await runClaude(REQ, { token: 't', timeoutMs: 5000, spawn, workDir: '/tmp', signal: controller.signal });
  assert.equal(out.kind, 'aborted');
});

test('процесс не запустился — error с текстом, не исключение', async () => {
  const spawn = () => {
    throw new Error('spawn claude ENOENT');
  };
  const out = await runClaude(REQ, { token: 't', timeoutMs: 1000, spawn, workDir: '/tmp' });
  assert.equal(out.kind, 'error');
  assert.match(out.message, /ENOENT/);
});
