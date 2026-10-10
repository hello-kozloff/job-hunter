#!/usr/bin/env node
// Прогон кода Code-ноды n8n на фикстурах — без n8n.
//
//   node scripts/run-code-node.mjs <code.js> <input> [--ref Имя=<json|@файл.json>]... [--env KEY=value]...
//                                  [--static <json|@файл.json>] [--status N] [--out файл.json]
//
//   <input>  .html — ответ HTTP Request (несколько файлов через запятую = несколько страниц)
//            .json — массив items: [{ "json": {...} }] или просто объектов
//   --ref    данные для $('Имя') — то, что в n8n вернула бы нода с этим именем
//   --env    переменная для $env (в n8n — из environment контейнера)
//   --static static data workflow для $getWorkflowStaticData (в n8n хранится между запусками);
//            после прогона печатается, если код её изменил
//   --status код ответа для .html (по умолчанию 200)
//   --out    сохранить полный вывод в JSON (чтобы передать в следующую ноду)
//
// Пример:
//   node scripts/run-code-node.mjs n8n/w1-collector/parse-search.js \
//     fixtures/search-p0.html,fixtures/search-p1.html --ref 'Plan={"firstRun":true}'
import { readFileSync, writeFileSync } from 'node:fs';
import { readCode } from './lib/code.mjs';

const args = process.argv.slice(2);
const [codePath, inputArg] = args;
if (!codePath || !inputArg) {
  console.error('usage: node scripts/run-code-node.mjs <code.js> <input> [--ref Имя=json]... [--status N] [--out file]');
  process.exit(2);
}

const toItems = (value) =>
  (Array.isArray(value) ? value : [value]).map((v) => (v && typeof v === 'object' && 'json' in v ? v : { json: v }));

const refs = {};
const $env = {};
let staticData = {};
let status = 200;
let outPath = null;
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--ref') {
    const [name, ...rest] = args[++i].split('=');
    const raw = rest.join('=');
    refs[name] = toItems(JSON.parse(raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw));
  } else if (args[i] === '--static') {
    const raw = args[++i];
    staticData = JSON.parse(raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw);
  } else if (args[i] === '--env') {
    const [key, ...rest] = args[++i].split('=');
    $env[key] = rest.join('=');
  } else if (args[i] === '--status') {
    status = Number(args[++i]);
  } else if (args[i] === '--out') {
    outPath = args[++i];
  }
}

const input = inputArg.endsWith('.json')
  ? toItems(JSON.parse(readFileSync(inputArg, 'utf8')))
  : inputArg.split(',').map((path) => ({
      json: { statusCode: status, statusMessage: '', headers: {}, data: readFileSync(path, 'utf8') },
    }));

// Мини-версии $input и $('Имя') из n8n
// itemMatching(i) — связанный item по номеру (в n8n — по pairedItem; здесь — тот же номер)
const accessor = (items) => ({
  all: () => items,
  first: () => items[0],
  last: () => items.at(-1),
  itemMatching: (i) => items[i],
});
const $input = accessor(input);
const $ = (name) => {
  if (!refs[name]) throw new Error(`Нет данных для $('${name}') — передай --ref ${name}=...`);
  return accessor(refs[name]);
};

// Исполняем файл Code-ноды из этого репозитория как тело async-функции — так же, как n8n.
// Это локальный инструмент разработчика: на вход только свои файлы, не внешние данные.
const code = readCode(codePath);
const staticBefore = JSON.stringify(staticData);
const $getWorkflowStaticData = () => staticData;
const run = new Function('$input', '$', '$env', '$getWorkflowStaticData', `return (async () => {\n${code}\n})();`);
const out = await run($input, $, $env, $getWorkflowStaticData);

if (!Array.isArray(out)) throw new Error('Code-нода должна вернуть массив items');
if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 2));

// Длинные строки (HTML) обрезаем, чтобы вывод читался
const preview = JSON.stringify(
  out,
  (key, value) => (typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…(${value.length})` : value),
  2,
);
if (JSON.stringify(staticData) !== staticBefore) console.log(`static data: ${JSON.stringify(staticData)}`);
console.log(`items: ${out.length}`);
console.log(preview.length > 6000 ? `${preview.slice(0, 6000)}\n…` : preview);
