// Запуск Code-нод n8n в тестах без n8n: файл ноды (с раскрытием // @include) — тело async-функции, как в n8n.
// Только свои файлы репозитория. Используют scripts/test-*.mjs.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readCode } from './code.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const compiled = new Map();
export function compile(file) {
  if (!compiled.has(file)) {
    const code = readCode(join(ROOT, file));
    compiled.set(file, new Function('$', '$input', '$getWorkflowStaticData', '$env', `return (async () => {\n${code}\n})();`));
  }
  return compiled.get(file);
}

// Мини-версия $input и $('Имя') из n8n
export const accessor = (items) => ({ all: () => items, first: () => items[0], last: () => items.at(-1) });

// Выполнить ноду: nodes — { имя ноды: [json…] | json }, input — items $input, state — static data
export async function runNode(file, { nodes = {}, input = [{}], state = {}, env = {} }) {
  const data = Object.fromEntries(
    Object.entries(nodes).map(([name, value]) => [name, (Array.isArray(value) ? value : [value]).map((json) => ({ json }))]),
  );
  const $ = (name) => {
    if (!data[name]) throw new Error(`нет данных для ${name}`);
    return accessor(data[name]);
  };
  const out = await compile(file)($, accessor(input.map((json) => ({ json }))), () => state, env);
  return out.map((item) => item.json);
}
