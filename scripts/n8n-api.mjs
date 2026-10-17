#!/usr/bin/env node
// Мини-клиент внутреннего REST API локального n8n — то же, что делает редактор в браузере.
//
//   node scripts/n8n-api.mjs setup-owner <email>      создать владельца (один раз), пароль → .env
//   node scripts/n8n-api.mjs run <workflowId> [нода]   запустить с ноды Manual (до указанной ноды включительно)
//                                                      и вывести сводку по нодам
//   node scripts/n8n-api.mjs publish <workflowId>      опубликовать (включить триггеры) текущую версию
//   node scripts/n8n-api.mjs unpublish <workflowId>    снять с публикации
//   node scripts/n8n-api.mjs executions <workflowId> [limit]   последние запуски
//   node scripts/n8n-api.mjs rows <table> [limit]      показать строки таблицы Data Tables
//   node scripts/n8n-api.mjs migrate                   создать недостающие таблицы и колонки по n8n/schema.mjs
//   node scripts/n8n-api.mjs blacklist-seed            дописать в таблицу blacklist компании из n8n/blacklist.json
//   node scripts/n8n-api.mjs tunnel-env                по .env: туннель (NGROK_DOMAIN → WEBHOOK_URL) и профили
//                                                      docker compose (tunnel, applier — робот-отклик) в COMPOSE_PROFILES
//   node scripts/n8n-api.mjs api-key | docker exec -i …  ключ публичного API n8n для W6 → JSON credential в stdout
//                                                      (только через pipe в n8n import:credentials, см. docs/stages/stage-5.md)
//   node scripts/n8n-api.mjs requeue <days> [--dry]    вернуть в обработку вакансии бэкфилла (seen) за N дней:
//                                                      удалить их строки, следующий запуск W1 примет их как новые
//                                                      (--dry — только показать, что удалится)
//   node scripts/n8n-api.mjs recheck <правило> [--dry]  правило фильтра поменялось: удалить строки, отсеянные
//                                                      им (rejected, правило в reasons, например «Vue/Angular»),
//                                                      следующий запуск W1 оценит их по текущим правилам
//   node scripts/n8n-api.mjs profile-import <file.json> профиль и настройки бота в таблицу settings: JSON
//                                                      { "имя настройки": значение } (docs/onboarding.md)
//   node scripts/n8n-api.mjs profile-export [file.json] все строки settings в JSON того же вида (бэкап, перенос);
//                                                      без файла — в stdout. Там резюме — файл с правами 600
//   node scripts/n8n-api.mjs resume-labels [--dry] [--move <id,…>]  резюме больше одного: подписи «📄 Резюме» у
//                                                      вакансий, собранных раньше; вакансии удалённых резюме — основному;
//                                                      --move — названные строки основному (docs/resumes.md)
//
// Вход — N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD из .env.
import { readFileSync, writeFileSync } from 'node:fs';
import { TABLES } from '../n8n/schema.mjs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readCode } from './lib/code.mjs';

import { readEnv, setEnv, local } from './lib/env.mjs';

const BASE = `http://127.0.0.1:${local().n8nPort}/rest`;

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${String(typeof json === 'string' ? json : JSON.stringify(json)).slice(0, 400)}`);
  return { json: json?.data ?? json, res };
}

// Cookie сессии кэшируется в .n8n-session (права 600, не в git): n8n ограничивает частоту входов (429)
const SESSION_URL = new URL('../.n8n-session', import.meta.url);

async function login() {
  try {
    const cached = readFileSync(SESSION_URL, 'utf8').trim();
    if (cached) {
      await api('/login', { cookie: cached });
      return cached;
    }
  } catch {
    // нет файла или сессия истекла — входим заново
  }
  const env = readEnv();
  if (!env.N8N_OWNER_PASSWORD) throw new Error('В .env нет N8N_OWNER_PASSWORD — сначала setup-owner');
  const { res } = await api('/login', {
    method: 'POST',
    body: { emailOrLdapLoginId: env.N8N_OWNER_EMAIL, password: env.N8N_OWNER_PASSWORD },
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  writeFileSync(SESSION_URL, cookie, { mode: 0o600 });
  return cookie;
}

// n8n отдаёт данные запуска в формате flatted (JSON с ссылками по индексам) — порт flatted.parse
function unflatten(text) {
  const Primitive = String;
  const input = JSON.parse(text, (_, v) => (typeof v === 'string' ? new Primitive(v) : v)).map((v) =>
    v instanceof Primitive ? String(v) : v,
  );
  const parsed = new Set();
  const revive = (output) => {
    for (const k of Object.keys(output)) {
      const value = output[k];
      if (value instanceof Primitive) {
        const target = input[value];
        if (typeof target === 'object' && target !== null && !parsed.has(target)) {
          parsed.add(target);
          output[k] = revive(target);
        } else {
          output[k] = target;
        }
      }
    }
    return output;
  };
  const root = input[0];
  return typeof root === 'object' && root !== null ? (parsed.add(root), revive(root)) : root;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(workflowId, destination) {
  const cookie = await login();
  const { json } = await api(`/workflows/${workflowId}/run`, {
    method: 'POST',
    body: {
      triggerToStartFrom: { name: 'Manual' },
      ...(destination && { destinationNode: { nodeName: destination, mode: 'inclusive' } }),
    },
    cookie,
  });
  const executionId = json.executionId;
  if (!executionId) throw new Error(`Запуск не вернул executionId: ${JSON.stringify(json).slice(0, 300)}`);

  let execution;
  for (let i = 0; i < 300; i++) {
    ({ json: execution } = await api(`/executions/${executionId}`, { cookie }));
    if (execution.finished || ['success', 'error', 'crashed', 'canceled'].includes(execution.status)) break;
    await sleep(1000);
  }

  const data = typeof execution.data === 'string' ? unflatten(execution.data) : execution.data;
  const result = data?.resultData ?? {};
  console.log(`execution ${executionId}: ${execution.status}`);
  if (result.error) console.log(`ОШИБКА: ${result.error.message}${result.error.node ? ` (нода ${result.error.node.name})` : ''}`);
  for (const [name, runs] of Object.entries(result.runData ?? {})) {
    const last = runs.at(-1);
    const outputs = (last.data?.main ?? []).map((o) => o?.length ?? 0);
    console.log(`  ${name}: items ${JSON.stringify(outputs)}${last.error ? ` — ОШИБКА: ${last.error.message}` : ''}`);
  }
  return { executionId, data };
}

// Публикация через REST: запущенный n8n сразу регистрирует триггеры, перезапуск не нужен
async function publish(workflowId) {
  const cookie = await login();
  const { json: wf } = await api(`/workflows/${workflowId}`, { cookie });
  await api(`/workflows/${workflowId}/activate`, { method: 'POST', body: { versionId: wf.versionId }, cookie });
  console.log(`${wf.name}: опубликован`);
}

async function unpublish(workflowId) {
  const cookie = await login();
  const { json: wf } = await api(`/workflows/${workflowId}`, { cookie });
  await api(`/workflows/${workflowId}/deactivate`, { method: 'POST', body: {}, cookie });
  console.log(`${wf.name}: снят с публикации`);
}

async function executions(workflowId, limit = 5) {
  const cookie = await login();
  const filter = encodeURIComponent(JSON.stringify({ workflowId }));
  const { json } = await api(`/executions?filter=${filter}&limit=${limit}`, { cookie });
  for (const e of json.results ?? []) {
    console.log(`${e.id}\t${e.status}\t${e.mode}\t${e.startedAt}`);
  }
}

async function personalProject(cookie) {
  const { json: projects } = await api('/projects', { cookie });
  return (Array.isArray(projects) ? projects : []).find((p) => p.type === 'personal');
}

async function migrate() {
  const cookie = await login();
  const project = await personalProject(cookie);
  const base = `/projects/${project.id}/data-tables`;
  const { json: list } = await api(base, { cookie });
  const existing = list.data ?? list;
  for (const [name, columns] of Object.entries(TABLES)) {
    const table = existing.find((t) => t.name === name);
    if (!table) {
      await api(base, { method: 'POST', body: { name, columns: columns.map(([n, type]) => ({ name: n, type })) }, cookie });
      console.log(`${name}: создана (${columns.length} колонок)`);
      continue;
    }
    const { json: have } = await api(`${base}/${table.id}/columns`, { cookie });
    const names = new Set((have.data ?? have).map((c) => c.name));
    const missing = columns.filter(([n]) => !names.has(n));
    for (const [n, type] of missing) {
      await api(`${base}/${table.id}/columns`, { method: 'POST', body: { name: n, type }, cookie });
    }
    console.log(`${name}: ${missing.length ? `добавлены колонки ${missing.map(([n]) => n).join(', ')}` : 'схема актуальна'}`);
  }
}

async function rows(tableName, limit = 5) {
  const cookie = await login();
  const personal = await personalProject(cookie);
  const { json: tables } = await api(`/projects/${personal.id}/data-tables`, { cookie });
  const list = tables.data ?? tables;
  const table = list.find((t) => t.name === tableName);
  if (!table) throw new Error(`Таблица ${tableName} не найдена`);
  // take=0 n8n понимает как «без лимита», поэтому для одного счётчика берём 1 строку и не печатаем её
  const take = Math.max(1, Number(limit));
  const { json: content } = await api(
    `/projects/${personal.id}/data-tables/${table.id}/rows?take=${take}&skip=0&sortBy=id:desc`,
    { cookie },
  );
  console.log(`${tableName}: ${content.count} строк`);
  if (Number(limit) > 0) for (const row of content.data ?? []) console.log(JSON.stringify(row));
}

// Дописывает только тех, кого в таблице ещё нет (сравнение без учёта регистра) — повторный запуск безопасен
async function blacklistSeed() {
  const cookie = await login();
  const personal = await personalProject(cookie);
  const base = `/projects/${personal.id}/data-tables`;
  const { json: tables } = await api(base, { cookie });
  const table = (tables.data ?? tables).find((t) => t.name === 'blacklist');
  if (!table) throw new Error('Таблицы blacklist нет — сначала migrate');
  const { json: content } = await api(`${base}/${table.id}/rows?take=1000&skip=0`, { cookie });
  const have = new Set((content.data ?? []).map((r) => String(r.company ?? '').trim().toLowerCase()));
  const seed = JSON.parse(readFileSync(new URL('../n8n/blacklist.json', import.meta.url), 'utf8'));
  const add = seed.filter((r) => !have.has(r.company.trim().toLowerCase()));
  if (add.length) await api(`${base}/${table.id}/insert`, { method: 'POST', body: { data: add, returnType: 'count' }, cookie });
  console.log(`blacklist: добавлено ${add.length}, уже было ${seed.length - add.length}`);
}

// Выдача последнего успешного запуска W1 (нода «Split vacancies»): external_id и dup_key вакансий
async function lastSearch(cookie) {
  const filter = encodeURIComponent(JSON.stringify({ workflowId: 'jobHunterW1Colle', status: ['success'] }));
  const { json: list } = await api(`/executions?filter=${filter}&limit=1`, { cookie });
  const last = list.results?.[0];
  if (!last) throw new Error('Нет успешных запусков W1');
  const { json: execution } = await api(`/executions/${last.id}`, { cookie });
  const data = typeof execution.data === 'string' ? unflatten(execution.data) : execution.data;
  const search = (data.resultData.runData['Split vacancies']?.[0]?.data?.main?.[0] ?? []).map((i) => i.json);
  return { runId: last.id, has: (r) => search.some((v) => v.external_id === r.external_id || v.dup_key === r.dup_key) };
}

// Удалить строки таблицы vacancies, чьи вакансии есть в выдаче последнего успешного запуска W1:
// следующий запуск W1 примет их как новые и прогонит через текущие правила. Вакансии не из выдачи
// не трогаем — обычный запуск W1 читает одну страницу поиска, и они пропали бы из таблицы насовсем
async function forgetRows(pick, { dry, nothing, done }) {
  const vacancies = await dataTable('vacancies');
  const { cookie, base, table } = vacancies;
  const search = await lastSearch(cookie);
  const rows = (await allRows(vacancies)).filter((r) => pick(r) && search.has(r));
  const list = () => rows.forEach((r) => console.log(`  ${r.published_at.slice(0, 10)}  ${r.company} — ${r.title}`));
  if (!rows.length) return console.log(`${nothing} (выдача запуска ${search.runId})`);
  if (dry) {
    console.log(`Удалилось бы ${rows.length} строк (выдача запуска ${search.runId}):`);
    return list();
  }
  const conditions = { type: 'or', filters: rows.map((r) => ({ columnName: 'id', condition: 'eq', value: r.id })) };
  await api(`${base}/${table.id}/rows?filter=${encodeURIComponent(JSON.stringify(conditions))}`, { method: 'DELETE', cookie });
  console.log(`Удалено ${rows.length} строк (выдача запуска ${search.runId}). ${done}`);
  list();
}

// Бэкфилл (seen) за N дней — в обработку
async function requeue(days, flag) {
  if (!Number(days)) throw new Error('usage: requeue <days>');
  const since = Date.now() - Number(days) * 24 * 3600 * 1000;
  await forgetRows((r) => r.status === 'seen' && Date.parse(r.published_at) >= since, {
    dry: flag === '--dry',
    nothing: `Нечего возвращать: seen за ${days} дн. в выдаче нет`,
    done: 'Теперь: node scripts/n8n-api.mjs run jobHunterW1Colle',
  });
}

// Правило фильтра поменялось — перепроверить вакансии, которые оно отсеяло (rejected, правило в reasons)
async function recheck(rule, flag) {
  if (!rule) throw new Error('usage: recheck <правило из reasons, например Vue/Angular> [--dry]');
  const hasRule = (r) => String(r.reasons ?? '').split(', ').some((reason) => reason.replace(/:.*$/, '') === rule);
  await forgetRows((r) => r.status === 'rejected' && hasRule(r), {
    dry: flag === '--dry',
    nothing: `Нечего перепроверять: отсеянных правилом «${rule}» в выдаче нет`,
    done: 'Следующий запуск W1 оценит их заново: node scripts/n8n-api.mjs run jobHunterW1Colle',
  });
}

// Ключ публичного API n8n (W6 читает запуски за сутки). Старый ключ с той же меткой удаляется.
// В stdout — только JSON credential «n8n API»: ключ уходит прямо в n8n и на диск хоста не пишется
async function apiKey() {
  const LABEL = 'job-hunter W6';
  const cookie = await login();
  const { json: list } = await api('/api-keys', { cookie });
  const items = Array.isArray(list) ? list : (list.items ?? list.data ?? []);
  for (const k of items.filter((k) => k.label === LABEL)) await api(`/api-keys/${k.id}`, { method: 'DELETE', cookie });
  const { json: created } = await api('/api-keys', {
    method: 'POST',
    body: { label: LABEL, scopes: ['execution:list', 'execution:read'], expiresAt: null },
    cookie,
  });
  const key = created.rawApiKey ?? created.apiKey;
  if (!key) throw new Error('n8n не вернул ключ');
  process.stdout.write(
    JSON.stringify([
      { id: 'jobHunterN8nApi1', name: 'n8n API', type: 'n8nApi', data: { apiKey: key, baseUrl: 'http://localhost:5678/api/v1' } },
    ]),
  );
  console.error(`Ключ «${LABEL}» создан: execution:list, execution:read`);
}

// Туннель ngrok (кнопки Telegram): адрес вебхуков n8n и профиль docker compose — из NGROK_DOMAIN
// Профили docker compose и адреса туннеля — по .env: NGROK_DOMAIN → туннель ngrok (WEBHOOK_URL, профиль tunnel),
// APPLIER_TOKEN → робот-отклик (профиль applier, этап 6). Профили объединяются, а не затираются
function tunnelEnv() {
  const env = readEnv();
  const domain = String(env.NGROK_DOMAIN ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (!domain && !env.APPLIER_TOKEN) throw new Error('В .env нет ни NGROK_DOMAIN, ни APPLIER_TOKEN');
  const profiles = new Set(
    String(env.COMPOSE_PROFILES ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  );
  const vars = {};
  if (domain) {
    Object.assign(vars, { NGROK_DOMAIN: domain, WEBHOOK_URL: `https://${domain}/` });
    profiles.add('tunnel');
  }
  if (env.APPLIER_TOKEN) profiles.add('applier');
  vars.COMPOSE_PROFILES = [...profiles].join(',');
  if (Object.entries(vars).every(([k, v]) => env[k] === v)) return;
  setEnv(vars, 'Профили docker compose и туннель ngrok (scripts/n8n-api.mjs tunnel-env)');
  console.log(`.env: ${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

async function setupOwner(email) {
  const env = readEnv();
  if (env.N8N_OWNER_PASSWORD) {
    console.log('Владелец уже записан в .env');
    return;
  }
  if (!email) throw new Error('usage: setup-owner <email>');
  // Требования n8n: 8–64 символа, есть цифра и заглавная буква
  const password = `Jh${randomBytes(15).toString('base64url')}7`;
  await api('/owner/setup', {
    method: 'POST',
    body: { email, firstName: 'Job', lastName: 'Hunter', password },
  });
  setEnv(
    { N8N_OWNER_EMAIL: email, N8N_OWNER_PASSWORD: password },
    `Владелец локального n8n (scripts/n8n-api.mjs setup-owner). Вход: http://localhost:${local().n8nPort}`,
  );
  console.log(`Владелец ${email} создан, пароль записан в .env`);
}

// Таблица Data Tables по имени: { cookie, base, table } для запросов к её строкам
async function dataTable(name) {
  const cookie = await login();
  const personal = await personalProject(cookie);
  const base = `/projects/${personal.id}/data-tables`;
  const { json: tables } = await api(base, { cookie });
  const table = (tables.data ?? tables).find((t) => t.name === name);
  if (!table) throw new Error(`Таблицы ${name} нет — сначала migrate`);
  return { cookie, base, table };
}

// Все строки таблицы: n8n отдаёт не больше 250 за запрос, сколько бы ни просили в take (проверено 17.10.2026 на 2.42.3)
async function allRows({ cookie, base, table }) {
  const out = [];
  for (;;) {
    const { json } = await api(`${base}/${table.id}/rows?take=250&skip=${out.length}&sortBy=id:asc`, { cookie });
    const page = json.data ?? [];
    out.push(...page);
    if (!page.length || out.length >= (json.count ?? 0)) return out;
  }
}

// Схема настроек бота и список резюме — тот же код, что в Code-нодах (n8n/shared/settings.js, resumes.js)
const shared = (file) => readCode(fileURLToPath(new URL(`../n8n/shared/${file}`, import.meta.url)));
const { SETTINGS, validSetting, loadSettings, resumeList } = new Function(
  `${shared('settings.js')}\n${shared('resumes.js')}\nreturn { SETTINGS, validSetting, loadSettings, resumeList };`,
)();

// Профиль и настройки из JSON { "имя": значение } → upsert строк settings по name. Значения проверяются схемой:
// хоть одно не проходит — не пишется ничего. Неизвестное этой версии имя пишется с предупреждением (код его
// пропускает, пока не узнает)
async function profileImport(file) {
  if (!file) throw new Error('usage: profile-import <file.json>');
  const values = JSON.parse(readFileSync(file, 'utf8'));
  const bad = Object.entries(values).filter(([name, value]) => SETTINGS[name] && !validSetting(SETTINGS[name], value));
  if (bad.length) throw new Error(`Не проходят проверку: ${bad.map(([name]) => name).join(', ')} — ничего не записано`);
  const unknown = Object.keys(values).filter((name) => !SETTINGS[name]);
  const { cookie, base, table } = await dataTable('settings');
  for (const [name, value] of Object.entries(values)) {
    await api(`${base}/${table.id}/upsert`, {
      method: 'POST',
      body: {
        filter: { type: 'and', filters: [{ columnName: 'name', condition: 'eq', value: name }] },
        data: { name, value_json: JSON.stringify(value) },
      },
      cookie,
    });
  }
  console.log(`settings: записано ${Object.keys(values).length}: ${Object.keys(values).join(', ')}`);
  if (unknown.length) console.log(`⚠️  Этой версии кода неизвестны (пока не используются): ${unknown.join(', ')}`);
}

async function profileExport(file) {
  const { cookie, base, table } = await dataTable('settings');
  const { json: content } = await api(`${base}/${table.id}/rows?take=1000&skip=0`, { cookie });
  const values = Object.fromEntries(
    (content.data ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((r) => [r.name, JSON.parse(r.value_json)]),
  );
  const json = `${JSON.stringify(values, null, 2)}\n`;
  if (!file) return process.stdout.write(json);
  writeFileSync(file, json, { mode: 0o600 });
  console.log(`${file}: ${Object.keys(values).length} настроек`);
}

// Подписи «📄 Резюме» у вакансий, собранных до 17.10.2026 (docs/resumes.md). Теперь W1 пишет resume_name всем вакансиям,
// пока резюме больше одного, а W11 обновляет его при переименовании и удалении резюме. Разово:
//   вакансии основного без подписи — название основного;
//   вакансии удалённого резюме — основному (оценка, письма и робот их так и ведут, а номер займёт новое резюме);
//   подпись не совпадает с названием резюме — переименовали раньше или номер занят заново: сам не различит, только
//   список; --move <id,…> — эти строки основному
async function resumeLabels(...args) {
  const dry = args.includes('--dry');
  const at = args.indexOf('--move');
  const move = at >= 0 ? String(args[at + 1] ?? '').split(',').map(Number).filter(Boolean) : [];
  if (at >= 0 && !move.length) throw new Error('usage: resume-labels [--dry] [--move <id,…>]');
  const stored = await allRows(await dataTable('settings'));
  const list = resumeList(loadSettings(stored.map((json) => ({ json }))));
  if (list.length < 2) return console.log('Резюме одно — подписи «📄 Резюме» не нужны');
  const names = new Map(list.map((r) => [r.id, r.name]));
  const main = names.get('r1');

  const vacancies = await dataTable('vacancies');
  const { cookie, base, table } = vacancies;
  const rows = await allRows(vacancies);
  const label = rows.filter((r) => !r.resume_id && !r.resume_name);
  const orphans = rows.filter((r) => r.resume_id && !names.has(r.resume_id));
  const moved = rows.filter((r) => move.includes(r.id));
  const odd = rows.filter((r) => r.resume_id && names.has(r.resume_id) && r.resume_name !== names.get(r.resume_id) && !move.includes(r.id));
  const missing = move.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw new Error(`Нет вакансий ${missing.map((id) => `/v${id}`).join(', ')} — ничего не записано`);

  const patch = async (group, data) => {
    for (let i = 0; i < group.length; i += 100) {
      const filters = group.slice(i, i + 100).map((r) => ({ columnName: 'id', condition: 'eq', value: r.id }));
      await api(`${base}/${table.id}/rows`, { method: 'PATCH', cookie, body: { filter: { type: 'or', filters }, data } });
    }
  };
  const verb = dry ? 'записалось бы' : 'записано';
  if (!dry) {
    await patch(label, { resume_name: main });
    await patch([...orphans, ...moved], { resume_id: '', resume_name: main });
  }
  console.log(`Вакансии основного без подписи: ${label.length} → «${main}» (${verb})`);
  console.log(`Вакансии удалённых резюме: ${orphans.length} → основному (${verb})`);
  if (move.length) console.log(`--move: ${moved.length} → основному (${verb})`);
  const line = (r) => `  /v${r.id} ${r.resume_id} «${r.resume_name ?? ''}» ≠ «${names.get(r.resume_id)}» · ${r.status} · ${r.title}`;
  if (odd.length) {
    console.log('Подпись не совпадает с названием резюме — переименовали раньше или номер занят заново.');
    console.log('Номер занят заново — перенести основному: resume-labels --move <id,…>');
    odd.forEach((r) => console.log(line(r)));
  }
}

const [command, ...args] = process.argv.slice(2);
const commands = {
  'setup-owner': setupOwner,
  run,
  publish,
  unpublish,
  executions,
  rows,
  migrate,
  'blacklist-seed': blacklistSeed,
  'tunnel-env': tunnelEnv,
  requeue,
  recheck,
  'api-key': apiKey,
  'profile-import': profileImport,
  'profile-export': profileExport,
  'resume-labels': resumeLabels,
};
if (!commands[command]) {
  console.error(
    'usage: node scripts/n8n-api.mjs setup-owner <email> | run <id> [node] | publish <id> | unpublish <id> | executions <id> [limit] | rows <table> [limit] | migrate | blacklist-seed | tunnel-env | requeue <days> [--dry] | recheck <rule> [--dry] | api-key | profile-import <file.json> | profile-export [file.json] | resume-labels [--dry] [--move <id,…>]',
  );
  process.exit(2);
}
await commands[command](...args);
