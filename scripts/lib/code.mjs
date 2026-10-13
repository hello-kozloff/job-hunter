// Код Code-ноды из файла репозитория. Строка «// @include <путь от корня репо>» заменяется
// содержимым файла: так общий код (n8n/shared/*.js) попадает в несколько нод без импортов,
// которых в n8n нет. Используют scripts/build-workflows.mjs и scripts/run-code-node.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function readCode(path) {
  return readFileSync(path, 'utf8').replace(/^\/\/ @include (\S+)[ \t]*$/gm, (_, include) =>
    readFileSync(join(ROOT, include), 'utf8').trim(),
  );
}
