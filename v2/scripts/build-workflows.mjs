#!/usr/bin/env node
// Сборка workflow n8n v2 → v2/n8n/workflows/*.json (не править руками). Импорт — v2/scripts/deploy.sh.
//
// n8n v2 только оркеструет: расписание, запросы к hh (по одному, с паузой), порядок шагов, тревоги.
// Вся логика — в ядре (POST $CORE_URL/internal/*, заголовок X-Internal-Token).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../n8n/workflows/', import.meta.url).pathname;

// Постоянные id: повторный импорт обновляет те же workflow
export const IDS = {
  collect: 'jobHunterV2Collc',
  errors: 'jobHunterV2Error',
};

const uuid = (seed) => {
  const h = createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const node = (wf, name, type, typeVersion, position, parameters, extra = {}) => ({
  id: uuid(`v2/${wf}/${name}`),
  name,
  type: type.includes('.') ? type : `n8n-nodes-base.${type}`,
  typeVersion,
  position,
  parameters,
  ...extra,
});

// links: [откуда, куда, номер выхода]. Execution order v1: ветки одного выхода идут по очереди сверху вниз
function connect(links) {
  const connections = {};
  for (const [from, to, output = 0] of links) {
    connections[from] ??= { main: [] };
    while (connections[from].main.length <= output) connections[from].main.push([]);
    connections[from].main[output].push({ node: to, type: 'main', index: 0 });
  }
  return connections;
}

const workflow = (id, name, nodes, links, settings = {}) => ({
  id,
  name,
  nodes,
  connections: connect(links),
  settings: { executionOrder: 'v1', ...settings },
  pinData: {},
  active: false,
  tags: [],
});

const BROWSER_HEADERS = [
  ['User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'],
  ['Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],
  ['Accept-Language', 'ru-RU,ru;q=0.9,en;q=0.8'],
];
const pairs = (list) => ({ parameters: list.map(([name, value]) => ({ name, value })) });

// GET к hh: полный ответ текстом (тело — в поле data), без исключений на 4xx/5xx и без редиректов,
// по одному запросу с паузой — бережём домашний IP (глобальный бюджет считает ядро)
const hhGet = (url, headers = BROWSER_HEADERS) => ({
  method: 'GET',
  url,
  sendHeaders: true,
  specifyHeaders: 'keypair',
  headerParameters: pairs(headers),
  options: {
    batching: { batch: { batchSize: 1, batchInterval: 4000 } },
    redirect: { redirect: { followRedirects: false } },
    response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } },
    timeout: 30000,
  },
});

// POST в ядро: тело — выражение, ответ — JSON; ошибка ядра роняет запуск → V2 Errors → тревога
const core = (path, body) => ({
  method: 'POST',
  url: `={{ $env.CORE_URL }}/internal/${path}`,
  sendHeaders: true,
  specifyHeaders: 'keypair',
  headerParameters: pairs([['X-Internal-Token', '={{ $env.INTERNAL_TOKEN }}']]),
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify(${body}) }}`,
  options: { timeout: 120000 },
});

// Запрос сбора: от расписания — {kind: schedule}; от бота (webhook) — проверка секрета и {kind, profile_id, chat_id}
const REQUEST_CODE = `const j = $input.first().json;
if (j.body !== undefined) {
  if ((j.headers || {})['x-internal-token'] !== $env.INTERNAL_TOKEN) throw new Error('v2-collect: неверный X-Internal-Token');
  const b = j.body || {};
  return [{ json: { kind: b.kind || 'bot', profile_id: b.profile_id ?? null, chat_id: b.chat_id ?? null } }];
}
return [{ json: { kind: 'schedule', profile_id: null, chat_id: null } }];`;

const W = {
  'v2-collect': workflow(
    IDS.collect,
    'V2 Collect',
    [
      node('collect', 'Every 5 min', 'scheduleTrigger', 1.2, [0, 0], {
        rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] },
      }),
      node('collect', 'From bot', 'webhook', 2, [0, 200], {
        httpMethod: 'POST',
        path: 'v2-collect',
        responseMode: 'onReceived',
        options: {},
      }, { webhookId: uuid('v2-collect-webhook') }),
      node('collect', 'Request', 'code', 2, [220, 100], { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: REQUEST_CODE }),
      node('collect', 'Plan', 'httpRequest', 4.2, [440, 100], core('collect/plan', '$json')),
      node('collect', 'Has run', 'if', 2.2, [660, 100], {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{ id: uuid('has-run'), leftValue: '={{ Boolean($json.run_id) }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
          combinator: 'and',
        },
        options: {},
      }),
      node('collect', 'Tasks', 'splitOut', 1, [880, 0], { fieldToSplitOut: 'tasks', options: {} }),
      node('collect', 'Search hh', 'httpRequest', 4.2, [1100, 0], hhGet('={{ $json.url }}')),
      node('collect', 'Ingest search', 'httpRequest', 4.2, [1320, 0], core(
        'collect/search',
        "{ run_id: $('Tasks').item.json.run_id, search_id: $('Tasks').item.json.search_id, status: $json.statusCode, html: $json.data ?? '', location: ($json.headers || {}).location ?? null }",
      )),
      node('collect', 'Pages', 'splitOut', 1, [1540, 0], { fieldToSplitOut: 'pages', options: {} }),
      node('collect', 'Vacancy hh', 'httpRequest', 4.2, [1760, 0], hhGet('={{ $json.url }}', [...BROWSER_HEADERS, ['Referer', 'https://hh.ru/search/vacancy']])),
      node('collect', 'Ingest vacancy', 'httpRequest', 4.2, [1980, 0], core(
        'collect/vacancy',
        "{ run_id: $('Pages').item.json.run_id, vacancy_id: $('Pages').item.json.vacancy_id, status: $json.statusCode, html: $json.data ?? '' }",
      )),
      // Ниже ветки задач: выполняется после неё целиком (execution order v1)
      node('collect', 'Finish', 'httpRequest', 4.2, [880, 300], core('collect/finish', "{ run_id: $('Plan').first().json.run_id }"), {
        executeOnce: true,
      }),
    ],
    [
      ['Every 5 min', 'Request'],
      ['From bot', 'Request'],
      ['Request', 'Plan'],
      ['Plan', 'Has run'],
      ['Has run', 'Tasks'],
      ['Has run', 'Finish'],
      ['Tasks', 'Search hh'],
      ['Search hh', 'Ingest search'],
      ['Ingest search', 'Pages'],
      ['Pages', 'Vacancy hh'],
      ['Vacancy hh', 'Ingest vacancy'],
    ],
    {
      errorWorkflow: IDS.errors,
      // Успешные сборы не храним: страница выдачи ~1,7 МБ (итог — в таблице runs ядра)
      saveDataSuccessExecution: 'none',
    },
  ),

  'v2-errors': workflow(
    IDS.errors,
    'V2 Errors',
    [
      node('errors', 'On error', 'errorTrigger', 1, [0, 0], {}),
      node('errors', 'Alert', 'httpRequest', 4.2, [220, 0], core(
        'alert',
        "{ source: 'n8n: ' + $json.workflow.name, message: (($json.execution.error || {}).message || 'ошибка') + ' (нода ' + ($json.execution.lastNodeExecuted || '?') + ')' }",
      )),
    ],
    [['On error', 'Alert']],
  ),
};

mkdirSync(OUT, { recursive: true });
for (const [file, wf] of Object.entries(W)) writeFileSync(`${OUT}${file}.json`, `${JSON.stringify(wf, null, 2)}\n`);
console.log(`v2 workflows: ${Object.keys(W).join(', ')}`);
