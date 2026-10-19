// Разбор ответа claude -p --output-format stream-json --verbose: строка JSON на событие.
//   system/init        — модель запуска;
//   rate_limit_event   — загрузка окон подписки (5 ч, неделя) и время сброса; status rejected — лимит кончился;
//   system/api_retry   — CLI повторяет запрос: error = rate_limit, authentication_failed, overloaded…;
//   assistant с error  — синтетическое сообщение об ошибке API (текст: «You've hit your session limit · resets 6:10pm»);
//   result             — итог: structured_output (ответ по --json-schema), usage, modelUsage, is_error, api_error_status.
// Сбой распознаём по событиям, текст — запасной путь (его форма не документирована).

// Сбои, при которых ждать повторов CLI незачем: лимит подписки и вход — сразу запасной Gemini
export const FATAL_RETRY = new Set(['rate_limit', 'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'billing_error']);
const AUTH_ERRORS = new Set(['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'billing_error']);
const DOWN_ERRORS = new Set(['overloaded', 'server_error']);
const SUBSCRIPTION_LIMIT_RE = /hit your [\w\s-]*limit|usage limit|limit reached|out of (extra )?usage/i;
const LIMIT_RE = /rate.?limit|too many requests/i;
const AUTH_RE = /oauth (access )?token (is invalid|has expired|has been revoked|was revoked)|failed to authenticate|not logged in|login expired|invalid api key|please run \/login/i;
const DOWN_RE = /overloaded|internal server error|service unavailable/i;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function newRun() {
  return {
    model: null,
    window: null,
    limitStatus: null,
    limitType: null,
    resetsAt: null,
    retryError: null,
    retryStatus: null,
    assistantError: null,
    assistantText: '',
    result: null,
  };
}

// Строка stdout → состояние запуска. 'fatal' — убить процесс сразу, 'done' — итог пришёл
export function feed(run, line) {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return null;
  }
  if (m.type === 'system' && m.subtype === 'init') run.model = m.model ?? run.model;
  else if (m.type === 'rate_limit_event') {
    const info = m.rate_limit_info ?? {};
    if (info.unifiedWindows) run.window = info.unifiedWindows;
    run.limitStatus = info.status ?? run.limitStatus;
    run.limitType = info.rateLimitType ?? run.limitType;
    run.resetsAt = info.resetsAt ?? run.resetsAt;
  } else if (m.type === 'system' && m.subtype === 'api_retry') {
    run.retryError = m.error ?? null;
    run.retryStatus = m.error_status ?? null;
    if (FATAL_RETRY.has(m.error)) return 'fatal';
  } else if (m.type === 'assistant' && m.error) {
    run.assistantError = m.error;
    run.assistantText = (m.message?.content ?? []).map((c) => c.text ?? '').join('');
  } else if (m.type === 'result') {
    run.result = m;
    return 'done';
  }
  return null;
}

// Смещение пояса от UTC в минутах в момент at
function tzOffsetMin(at, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000) / 60000);
}

// Время сброса из текста ошибки: «…|1760234400» (старая форма), «resets 6:10pm», «resets at 15:00»,
// «resets Mon 12:00am» — по поясу tz, ближайшее в будущем. Не разобрали — null
export function parseReset(text, now, tz) {
  const epoch = String(text ?? '').match(/\|(\d{10})\b/);
  if (epoch) return Number(epoch[1]) * 1000;
  const m = String(text ?? '').match(/resets?\s+(?:at\s+)?(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let hour = Number(m[2]);
  const minute = Number(m[3] ?? 0);
  const ampm = m[4]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const offset = tzOffsetMin(now, tz);
  const local = new Date(now + offset * 60000); // местные часы в полях UTC
  let at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - offset * 60000;
  if (m[1]) {
    const want = WEEKDAYS.indexOf(m[1].slice(0, 3).toLowerCase());
    at += ((want - local.getUTCDay() + 7) % 7) * 86400000;
    if (at <= now) at += 7 * 86400000;
  } else if (at <= now) at += 86400000;
  return at;
}

// Лимит одной линейки моделей: «You've hit your Sonnet limit», rateLimitType вида seven_day_opus. Иначе — все модели
function familyIn(text, limitType) {
  const named = String(text ?? '').match(/\b(opus|sonnet|haiku)\s+(?:weekly\s+)?limit/i);
  if (named) return named[1].toLowerCase();
  const typed = String(limitType ?? '').match(/opus|sonnet|haiku/i);
  return typed ? typed[0].toLowerCase() : 'all';
}

// Модель, которая ответила на самом деле (CLI может сменить её на флаге безопасности): больше всего выходных токенов
function actualModel(modelUsage) {
  const entries = Object.entries(modelUsage ?? {});
  if (!entries.length) return null;
  return entries.sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0))[0][0];
}

const usageOf = (r) => ({
  input_tokens: r.usage?.input_tokens ?? 0,
  output_tokens: r.usage?.output_tokens ?? 0,
  cache_read_input_tokens: r.usage?.cache_read_input_tokens ?? 0,
  cache_creation_input_tokens: r.usage?.cache_creation_input_tokens ?? 0,
  thinking_tokens: r.usage?.output_tokens_details?.thinking_tokens ?? 0,
});

const firstLine = (text) =>
  String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
    ?.slice(0, 200) ?? '';

// Итог запуска: { kind: 'ok', model, json, text, usage } или сбой { kind: limit | auth | down | timeout | bad | error |
// aborted, message, until?, family? }. window — загрузка окон подписки (для бюджета оценок), если CLI её прислал
export function outcome(run, { killed = null, exitCode = 0, stderr = '', schema = true, now = Date.now(), tz = 'UTC' } = {}) {
  const r = run.result;
  const base = { window: run.window };
  if (killed === 'aborted') return { ...base, kind: 'aborted' };
  if (killed === 'timeout') return { ...base, kind: 'timeout', message: 'claude не ответил вовремя' };
  if (r && !r.is_error && r.subtype === 'success') {
    const model = actualModel(r.modelUsage) ?? run.model;
    const json = r.structured_output;
    if (schema && (json === undefined || json === null)) return { ...base, kind: 'bad', model, message: 'ответа по схеме нет' };
    return { ...base, kind: 'ok', model, json, text: schema ? JSON.stringify(json) : String(r.result ?? ''), usage: usageOf(r), ms: r.duration_ms };
  }
  // Текст ошибки — из итога и синтетического сообщения; stderr — только для «что случилось» (там бывают имена моделей)
  const text = [r?.result, run.assistantText].filter(Boolean).join('\n');
  const status = r?.api_error_status ?? run.retryStatus ?? null;
  const subscription = run.limitStatus === 'rejected' || SUBSCRIPTION_LIMIT_RE.test(text);
  if (subscription || run.retryError === 'rate_limit' || run.assistantError === 'rate_limit' || status === 429 || LIMIT_RE.test(text)) {
    const until =
      (run.limitStatus === 'rejected' && run.resetsAt ? run.resetsAt * 1000 : null) ??
      parseReset(text, now, tz) ??
      // Форма не разобрана: лимит подписки — полчаса без CLI, разовый 429 — пять минут
      now + (subscription ? 30 : 5) * 60000;
    return { ...base, kind: 'limit', until, family: familyIn(text, run.limitType), message: firstLine(text) || 'лимит запросов' };
  }
  if (AUTH_ERRORS.has(run.retryError) || AUTH_ERRORS.has(run.assistantError) || status === 401 || status === 403 || AUTH_RE.test(text)) {
    return { ...base, kind: 'auth', message: firstLine(text) || `HTTP ${status}` };
  }
  if (DOWN_ERRORS.has(run.retryError) || (status && status >= 500) || DOWN_RE.test(text)) {
    return { ...base, kind: 'down', message: firstLine(text) || `HTTP ${status}` };
  }
  if (r && String(r.subtype).startsWith('error_max')) {
    return { ...base, kind: 'bad', model: actualModel(r.modelUsage) ?? run.model, message: r.subtype };
  }
  return { ...base, kind: 'error', message: firstLine(text) || firstLine(stderr) || `код выхода ${exitCode}` };
}
