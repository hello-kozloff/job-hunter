// .env проекта: чтение и запись ключей. Общий код scripts/n8n-api.mjs, scripts/credentials.mjs, scripts/deploy.mjs и
// мастера установки scripts/install.mjs. Права файла — 600 (на Windows chmod не действует — это не ошибка).
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));

export function readEnv() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
      }),
  );
}

// Записать ключи в .env: существующие строки заменяются, новые дописываются в конец с комментарием
export function setEnv(vars, comment) {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : [];
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
  writeFileSync(ENV_PATH, `${out.join('\n').replace(/\n*$/, '')}\n`, { mode: 0o600 });
  try {
    chmodSync(ENV_PATH, 0o600);
  } catch {
    // Windows
  }
}

// Порты и имена из .env: тестовая установка рядом с рабочей — свой COMPOSE_PROJECT_NAME и порты
export function local(env = readEnv()) {
  const project = env.COMPOSE_PROJECT_NAME || 'job-hunter';
  return {
    project,
    n8nContainer: `${project}-n8n`,
    n8nPort: Number(env.N8N_PORT) || 5678,
    applierPort: Number(env.APPLIER_PORT) || 5682,
  };
}
