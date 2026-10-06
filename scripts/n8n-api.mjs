#!/usr/bin/env node
// Мини-клиент внутреннего REST API локального n8n — то же, что делает редактор в браузере.
//
//   node scripts/n8n-api.mjs setup-owner <email>      создать владельца (один раз), пароль → .env
//   node scripts/n8n-api.mjs run <workflowId>          запустить с ноды Manual и вывести сводку по нодам
//   node scripts/n8n-api.mjs publish <workflowId>      опубликовать (включить триггеры) текущую версию
//   node scripts/n8n-api.mjs unpublish <workflowId>    снять с публикации
//   node scripts/n8n-api.mjs executions <workflowId> [limit]   последние запуски
//   node scripts/n8n-api.mjs rows <table> [limit]      показать строки таблицы Data Tables
//   node scripts/n8n-api.mjs migrate                   создать недостающие таблицы и колонки по n8n/schema.mjs
//   node scripts/n8n-api.mjs blacklist-seed            дописать в таблицу blacklist компании из n8n/blacklist.json
//
// Вход — N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD из .env.
import { readFileSync, writeFileSync } from 'node:fs';
import { TABLES } from '../n8n/schema.mjs';
import { randomBytes } from 'node:crypto';

const BASE = 'http://127.0.0.1:5678/rest';
const ENV_URL = new URL('../.env', import.meta.url);

function readEnv() {
  return Object.fromEntries(
    readFileSync(ENV_URL, 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
      }),
  );
}

// Записать ключи в .env: существующие строки заменяются, новые дописываются в конец
function setEnv(vars, comment) {
  const lines = readFileSync(ENV_URL, 'utf8').split('\n');
  const rest = { ...vars };
  const out = lines.map((line) => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
    if (key && key in rest) {
      const value = rest[key];
      delete rest[key];
      return `${key}=${value}`;
    }
    return line;
  });
  const added = Object.entries(rest).map(([k, v]) => `${k}=${v}`);
  if (added.length) out.push('', `# ${comment}`, ...added);
  writeFileSync(ENV_URL, `${out.join('\n').replace(/\n*$/, '')}\n`, { mode: 0o600 });
}

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

async function login() {
  const env = readEnv();
  if (!env.N8N_OWNER_PASSWORD) throw new Error('В .env нет N8N_OWNER_PASSWORD — сначала setup-owner');
  const { res } = await api('/login', {
    method: 'POST',
    body: { emailOrLdapLoginId: env.N8N_OWNER_EMAIL, password: env.N8N_OWNER_PASSWORD },
  });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
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

async function run(workflowId) {
  const cookie = await login();
  const { json } = await api(`/workflows/${workflowId}/run`, {
    method: 'POST',
    body: { triggerToStartFrom: { name: 'Manual' } },
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
    body: { email, firstName: 'Никита', lastName: 'Костров', password },
  });
  setEnv(
    { N8N_OWNER_EMAIL: email, N8N_OWNER_PASSWORD: password },
    'Владелец локального n8n (scripts/n8n-api.mjs setup-owner). Вход: http://localhost:5678',
  );
  console.log(`Владелец ${email} создан, пароль записан в .env`);
}

const [command, ...args] = process.argv.slice(2);
const commands = { 'setup-owner': setupOwner, run, publish, unpublish, executions, rows, migrate, 'blacklist-seed': blacklistSeed };
if (!commands[command]) {
  console.error(
    'usage: node scripts/n8n-api.mjs setup-owner <email> | run <id> | publish <id> | unpublish <id> | executions <id> [limit] | rows <table> [limit] | migrate | blacklist-seed',
  );
  process.exit(2);
}
await commands[command](...args);
