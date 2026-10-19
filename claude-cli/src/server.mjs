// HTTP API «Claude по подписке» для n8n (W2, W5, W11, W13) и src/ask.mjs. Устройство — docs/claude-cli.md.
//   GET  /ping                 жив ли процесс (healthcheck Docker)
//   GET  /state                предохранитель, загрузка окон подписки, дорожки, счётчики с запуска
//   POST /v1/messages          запрос в форме Claude Messages API + task, effort, deadline_ms, fallback (src/handler.mjs)
//   POST /simulate {outcomes}  следующие вызовы — как сбой CLI, без запуска: limit, auth, down, timeout, bad
//   POST /reset                снять предохранитель и симуляцию
// Порта на хосте нет: сервис видит только n8n в сети compose `llm`. POST — только application/json (браузер не
// пошлёт такой запрос с чужой страницы без разрешения CORS), тело ≤ 2 МБ: промпт идёт дважды — для Claude и Gemini.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { createBreaker } from './limits.mjs';
import { createLanes } from './lanes.mjs';
import { createGemini } from './gemini.mjs';
import { createHandler } from './handler.mjs';
import { runClaude } from './cli.mjs';

const MAX_BODY = 2 * 1024 * 1024;
const POST_ROUTES = new Set(['/v1/messages', '/simulate', '/reset']);

class HttpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const errorBody = (type, message) => ({ type: 'error', error: { type, message } });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'тело запроса больше 2 МБ'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'тело — не JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handle(handler, req, res) {
  const receivedAt = Date.now();
  const url = new URL(req.url, 'http://claude-cli');
  if (req.method === 'GET' && url.pathname === '/ping') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (req.method === 'GET' && url.pathname === '/state') return send(res, 200, handler.state());
  if (req.method !== 'POST' || !POST_ROUTES.has(url.pathname)) return send(res, 404, errorBody('not_found_error', 'нет такого адреса'));
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
    return send(res, 415, errorBody('invalid_request_error', 'нужен Content-Type: application/json'));
  }
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, e.code ?? 400, errorBody('invalid_request_error', e.message));
  }
  if (url.pathname === '/simulate') {
    const out = handler.simulate(body.outcomes);
    return send(res, out.ok ? 200 : 400, out);
  }
  if (url.pathname === '/reset') {
    handler.reset();
    return send(res, 200, { ok: true });
  }
  // n8n не дождался (таймаут ноды) — снять задачу из очереди и остановить claude: лимит подписки зря не тратим
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  const out = await handler.complete(body, { signal: controller.signal, receivedAt });
  if (out) send(res, out.status, out.body);
}

export function createServer(handler) {
  return http.createServer((req, res) => {
    handle(handler, req, res).catch((e) => {
      log('http.error', { path: req.url, error: String(e.message).split('\n')[0] });
      if (!res.headersSent) send(res, 500, errorBody('api_error', String(e.message).split('\n')[0]));
    });
  });
}

function start() {
  const breaker = createBreaker({ scoreMaxUtil: config.scoreMaxUtil });
  const lanes = createLanes();
  const gemini = createGemini({ key: config.geminiKey, intervalMs: config.geminiIntervalMs });
  const handler = createHandler({
    config,
    breaker,
    lanes,
    gemini,
    log,
    run: (req, opts) => runClaude(req, { ...opts, token: config.token, workDir: config.workDir, isolate: config.isolate, tz: config.timezone }),
  });
  const server = createServer(handler);
  // Правка резюме (W13) идёт до 4–5 минут: стандартные таймауты Node обрывали бы ответ
  server.requestTimeout = 6 * 60 * 1000;
  server.headersTimeout = 60 * 1000;
  server.listen(config.port, () => {
    log('start', { version: config.version, token: Boolean(config.token), gemini: gemini.available, scoreMaxUtil: config.scoreMaxUtil });
    if (!config.token) log('warn', { message: 'нет CLAUDE_CODE_OAUTH_TOKEN: claude не запускается, вызовы уходят в запасной Gemini' });
  });

  // Мягкая остановка (деплой пересоздаёт контейнер): новые запросы не берём, идущие доделываем до 25 с
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    log('stop', { signal, running: lanes.running() });
    server.close();
    for (let waited = 0; lanes.running() && waited < 25000; waited += 500) await new Promise((r) => setTimeout(r, 500));
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) start();
