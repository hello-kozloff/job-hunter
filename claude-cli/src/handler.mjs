// Один запрос n8n (POST /v1/messages): проверка → предохранитель → дорожка → claude -p → при сбое запасной Gemini.
// Ответ — в форме Claude Messages API (ответил CLI) или сырой ответ Gemini (переход): Parse-ноды n8n читают оба
// прежним кодом. provider и model в ответе — кто ответил на самом деле (→ llm_model, letter_model).
import { randomUUID } from 'node:crypto';
import { EFFORTS, MODELS, familyOf } from './models.mjs';

// Сколько CLI может работать на задачу; меньше, если n8n ждёт меньше (deadline_ms)
const TASK_MAX_MS = { score: 60000, text: 270000 };
// Запас до срока n8n: успеть запасному Gemini (или хотя бы ответить)
const RESERVE_FALLBACK_MS = 35000;
const RESERVE_MS = 5000;
// Меньше этого CLI не запускаем — не успеет, сразу Gemini
const MIN_RUN_MS = { score: 15000, text: 30000 };
const DEFAULT_WAIT_MS = 170000;
// POST /simulate: следующие вызовы — как сбой CLI, без запуска (проверка перехода на Gemini на живой системе)
export const SIMULATED = ['limit', 'auth', 'down', 'timeout', 'bad'];

// Ответ без перехода на Gemini: HTTP-статус и тип ошибки в форме Claude API
const ERROR_OF = {
  limit: [429, 'rate_limit_error'],
  budget: [429, 'rate_limit_error'],
  auth: [401, 'authentication_error'],
  notoken: [401, 'authentication_error'],
  busy: [503, 'overloaded_error'],
  down: [503, 'overloaded_error'],
  timeout: [504, 'timeout_error'],
  bad: [502, 'api_error'],
  error: [500, 'api_error'],
};

const textOf = (value) =>
  typeof value === 'string' ? value : Array.isArray(value) ? value.map((part) => part?.text ?? '').join('\n') : '';

// Тело Claude API + наши поля → задание сервису или { error }
export function parseRequest(body, receivedAt) {
  const model = String(body?.model ?? '');
  if (!MODELS[model]) return { error: `модель «${model || '—'}» не из списка: ${Object.keys(MODELS).join(', ')}` };
  const user = textOf(body.messages?.[0]?.content);
  if (!user) return { error: 'нет текста задания (messages[0].content)' };
  const format = body.output_config?.format;
  const wait = Number(body.deadline_ms) > 0 ? Number(body.deadline_ms) : DEFAULT_WAIT_MS;
  return {
    model,
    family: familyOf(model),
    system: textOf(body.system),
    user,
    schema: format?.type === 'json_schema' && format.schema ? format.schema : null,
    task: body.task === 'score' ? 'score' : 'text',
    effort: EFFORTS.includes(body.effort) ? body.effort : 'low',
    deadline: receivedAt + wait,
    fallback: body.fallback?.model && body.fallback?.body ? { model: String(body.fallback.model), body: body.fallback.body } : null,
  };
}

export function createHandler({ config, breaker, lanes, gemini, run, log = () => {}, now = () => Date.now() }) {
  const simulated = [];
  const stats = { since: new Date(now()).toISOString(), calls: 0, cli: 0, gemini: 0, failed: 0, reasons: {} };

  const hhmm = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' });
  // Почему не Claude — коротко, для строки в Telegram («🤖 Claude по подписке: {note} — …»)
  function noteOf({ reason, until, family, utilization }) {
    const at = until ? ` до ${hhmm(until)}` : '';
    switch (reason) {
      case 'limit':
        return family && family !== 'all' ? `лимит ${family[0].toUpperCase()}${family.slice(1)}${at}` : `лимит подписки${at}`;
      case 'budget':
        return `окно подписки занято на ${Math.round(utilization * 100)}%${at} — оценки его не тратят`;
      case 'auth':
        return 'вход не работает: токен истёк или отозван';
      case 'notoken':
        return 'нет токена CLAUDE_CODE_OAUTH_TOKEN';
      case 'busy':
        return 'очередь не успела к сроку';
      case 'down':
        return 'сервер Claude не ответил';
      case 'timeout':
        return 'Claude не уложился по времени';
      case 'bad':
        return 'ответ Claude не по схеме';
      default:
        return 'сбой Claude CLI';
    }
  }

  const simOutcome = (kind) => ({
    kind,
    until: kind === 'limit' ? now() + 10 * 60000 : undefined,
    family: 'all',
    message: `симуляция: ${kind}`,
  });

  const usageFields = (out) => ({
    in: out.usage?.input_tokens,
    out: out.usage?.output_tokens,
    cacheRead: out.usage?.cache_read_input_tokens,
    cacheWrite: out.usage?.cache_creation_input_tokens,
    thinking: out.usage?.thinking_tokens,
  });
  const windowFields = (window) => ({ util5h: window?.five_hour?.utilization, util7d: window?.seven_day?.utilization });

  return {
    // Итог: { status, body } или null — n8n уже закрыл соединение, отвечать некому
    async complete(body, { signal, receivedAt = now() } = {}) {
      const req = parseRequest(body, receivedAt);
      if (req.error) return { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: req.error } } };
      stats.calls += 1;
      const canFallback = Boolean(req.fallback && gemini.available);
      const reserve = canFallback ? RESERVE_FALLBACK_MS : RESERVE_MS;

      let why = config.token ? breaker.blocked(req) : { reason: 'notoken' };
      if (!why) {
        let out;
        const sim = simulated.shift();
        if (sim) out = simOutcome(sim);
        // n8n ждёт меньше, чем нужно CLI с запасом на Gemini, — сразу запасной путь
        else if (req.deadline - now() - reserve < MIN_RUN_MS[req.task]) out = { kind: 'busy' };
        else {
          const release = await lanes.acquire(req.task, { waitUntil: req.deadline - reserve - MIN_RUN_MS[req.task], signal });
          if (signal?.aborted) {
            release?.();
            return null;
          }
          if (!release) out = { kind: 'busy' };
          else {
            try {
              out = await run(req, { timeoutMs: Math.min(TASK_MAX_MS[req.task], req.deadline - now() - reserve), signal });
            } finally {
              release();
            }
          }
        }
        if (out.kind === 'aborted' || signal?.aborted) return null;
        breaker.record(out);
        if (out.kind === 'ok') {
          stats.cli += 1;
          log('call', { task: req.task, provider: 'claude-cli', model: out.model, ms: now() - receivedAt, ...usageFields(out), ...windowFields(out.window) });
          return {
            status: 200,
            body: {
              id: `msg_cli_${randomUUID()}`,
              type: 'message',
              role: 'assistant',
              provider: 'claude-cli',
              model: out.model ?? req.model,
              content: [{ type: 'text', text: out.text }],
              stop_reason: 'end_turn',
              usage: out.usage,
            },
          };
        }
        why = { reason: out.kind, until: out.until, family: out.family, message: out.message, window: out.window };
      }

      stats.reasons[why.reason] = (stats.reasons[why.reason] ?? 0) + 1;
      const until = why.until ? new Date(why.until).toISOString() : null;
      const note = noteOf(why);
      if (canFallback) {
        const g = await gemini.call(req.fallback, { deadline: req.deadline, signal });
        if (signal?.aborted) return null;
        stats.gemini += 1;
        log('call', { task: req.task, provider: 'gemini', model: req.fallback.model, status: g.status, reason: why.reason, cli: why.message, ms: now() - receivedAt });
        const payload = Array.isArray(g.json) ? (g.json[0] ?? {}) : (g.json ?? {});
        return { status: g.status, body: { ...payload, provider: 'gemini', model: req.fallback.model, fallback: { reason: why.reason, until, note } } };
      }
      stats.failed += 1;
      const [status, type] = ERROR_OF[why.reason] ?? ERROR_OF.error;
      log('call', { task: req.task, provider: 'claude-cli', model: req.model, status, reason: why.reason, cli: why.message, ms: now() - receivedAt });
      return {
        status,
        body: { type: 'error', error: { type, message: `Claude по подписке: ${note}` }, provider: 'claude-cli', model: req.model, reason: why.reason, until },
      };
    },

    simulate(outcomes) {
      const list = (Array.isArray(outcomes) ? outcomes : []).map(String);
      const unknown = list.filter((o) => !SIMULATED.includes(o));
      if (!list.length || unknown.length) return { ok: false, error: `исходы: ${SIMULATED.join(', ')}`, unknown };
      simulated.push(...list);
      return { ok: true, queued: [...simulated] };
    },

    reset() {
      breaker.reset();
      simulated.length = 0;
    },

    state() {
      return {
        version: config.version,
        token: Boolean(config.token),
        gemini: gemini.available,
        breaker: breaker.state(),
        lanes: lanes.state(),
        simulated: [...simulated],
        stats,
      };
    },
  };
}
