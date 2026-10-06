#!/usr/bin/env node
// Сборка JSON workflow для импорта в n8n.
// Код Code-нод берётся из n8n/<workflow>/*.js — единственный источник правды.
//
//   node scripts/build-workflows.mjs   →   n8n/workflows/*.json
//
// Импорт в локальный n8n: scripts/deploy.sh
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(`${ROOT}${path}`, 'utf8');

// Постоянные id: повторный импорт обновляет те же workflow, а не создаёт копии
const IDS = {
  setup: 'jobHunterS0Setup',
  telegramTest: 'jobHunterS1TgTst',
  check: 'jobHunterW0Check',
  collector: 'jobHunterW1Colle',
  errors: 'jobHunterW4Error',
  telegramCredential: 'jobHunterTgBot01',
};

const uuid = (seed) => {
  const h = createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const node = (wf, name, type, typeVersion, position, parameters, extra = {}) => ({
  id: uuid(`${wf}/${name}`),
  name,
  type: `n8n-nodes-base.${type}`,
  typeVersion,
  position,
  parameters,
  ...extra,
});

// links: [откуда, куда, номер выхода] — выход 1 у If = ветка false
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

// ---------- Общие куски ----------

const SEARCH_QUERY = [
  ['text', 'NAME:(frontend OR front-end OR фронтенд OR react OR next.js OR nextjs OR typescript)'],
  ['professional_role', '96'],
  ['work_format', 'REMOTE'],
  ['education', 'not_required_or_not_specified'],
  ['order_by', 'publication_time'],
  ['items_on_page', '100'],
  ['enable_snippets', 'true'],
];

const BROWSER_HEADERS = [
  ['User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'],
  ['Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],
  ['Accept-Language', 'ru-RU,ru;q=0.9,en;q=0.8'],
];

const pairs = (list) => ({ parameters: list.map(([name, value]) => ({ name, value })) });

// HTTP Request к hh: полный ответ текстом, без исключений на 4xx/5xx и без редиректов
const hhRequest = ({ url, query, headers = BROWSER_HEADERS, batching = false }) => ({
  method: 'GET',
  url,
  sendQuery: Boolean(query),
  ...(query && { specifyQuery: 'keypair', queryParameters: pairs(query) }),
  sendHeaders: true,
  specifyHeaders: 'keypair',
  headerParameters: pairs(headers),
  options: {
    ...(batching && { batching: { batch: { batchSize: 1, batchInterval: 3000 } } }),
    redirect: { redirect: { followRedirects: false } },
    response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } },
    timeout: 30000,
  },
});

const code = (wf, name, file, position) =>
  node(wf, name, 'code', 2, position, { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: read(file) });

const telegram = (wf, name, position) =>
  node(
    wf,
    name,
    'telegram',
    1.2,
    position,
    {
      resource: 'message',
      operation: 'sendMessage',
      chatId: '={{ $env.TG_CHAT_ID }}',
      text: '={{ $json.text }}',
      additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true },
    },
    { credentials: { telegramApi: { id: IDS.telegramCredential, name: 'Telegram bot' } } },
  );

const ifTrue = (wf, expression) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
    conditions: [
      {
        id: uuid(`${wf}/if/${expression}`),
        leftValue: expression,
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      },
    ],
    combinator: 'and',
  },
  looseTypeValidation: false,
  options: {},
});

const VACANCIES = { __rl: true, mode: 'name', value: 'vacancies' };

// Колонки этапа 1. Имена = поля из n8n/w1-collector/parse-search.js
const COLUMNS = [
  ['source', 'string'],
  ['external_id', 'string'],
  ['dup_key', 'string'],
  ['title', 'string'],
  ['company', 'string'],
  ['company_id', 'string'],
  ['areas', 'string'],
  ['salary_from', 'number'],
  ['salary_to', 'number'],
  ['currency', 'string'],
  ['salary_gross', 'boolean'],
  ['experience', 'string'],
  ['employment_form', 'string'],
  ['work_formats', 'string'],
  ['languages', 'string'],
  ['key_skills', 'string'],
  ['has_test', 'boolean'],
  ['letter_required', 'boolean'],
  ['responses', 'number'],
  ['snippet', 'string'],
  ['url', 'string'],
  ['apply_url', 'string'],
  ['apply_type', 'string'],
  ['published_at', 'string'],
  ['status', 'string'],
];

// ---------- Workflow ----------

const workflows = {
  's0-setup': workflow(
    IDS.setup,
    'S0 Setup',
    [
      node('S0', 'Manual', 'manualTrigger', 1, [0, 0], {}),
      node('S0', 'Create table', 'dataTable', 1.1, [220, 0], {
        resource: 'table',
        operation: 'create',
        tableName: 'vacancies',
        columns: { column: COLUMNS.map(([name, type]) => ({ name, type })) },
        options: { createIfNotExists: true },
      }),
    ],
    [['Manual', 'Create table']],
  ),

  's1-telegram-test': workflow(
    IDS.telegramTest,
    'S1 Telegram test',
    [
      node('S1', 'Manual', 'manualTrigger', 1, [0, 0], {}),
      node('S1', 'Text', 'code', 2, [220, 0], {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: "return [{ json: { text: '✅ Job Hunter: n8n подключён к Telegram' } }];",
      }),
      telegram('S1', 'Telegram', [440, 0]),
    ],
    [
      ['Manual', 'Text'],
      ['Text', 'Telegram'],
    ],
  ),

  'w0-check-hh': workflow(
    IDS.check,
    'W0 Check hh',
    [
      node('W0', 'Manual', 'manualTrigger', 1, [0, 0], {}),
      node(
        'W0',
        'Search hh',
        'httpRequest',
        4.5,
        [220, 0],
        hhRequest({ url: 'https://hh.ru/search/vacancy', query: [...SEARCH_QUERY, ['page', '0']] }),
      ),
      code('W0', 'Check search', 'n8n/w0-check/check-search.js', [440, 0]),
      node(
        'W0',
        'Vacancy page',
        'httpRequest',
        4.5,
        [660, 0],
        hhRequest({
          url: '=https://hh.ru/vacancy/{{ $json.vacancyId }}',
          headers: [...BROWSER_HEADERS, ['Referer', 'https://hh.ru/search/vacancy']],
        }),
      ),
      code('W0', 'Check vacancy', 'n8n/w0-check/check-vacancy.js', [880, 0]),
    ],
    [
      ['Manual', 'Search hh'],
      ['Search hh', 'Check search'],
      ['Check search', 'Vacancy page'],
      ['Vacancy page', 'Check vacancy'],
    ],
  ),

  'w1-collector': workflow(
    IDS.collector,
    'W1 Collector',
    [
      node('W1', 'Schedule', 'scheduleTrigger', 1.4, [0, -100], {
        rule: { interval: [{ field: 'cronExpression', expression: '0 9-21/2 * * *' }] },
        // Mac спал во время запуска → после пробуждения выполнить последний пропущенный
        misfirePolicy: 'coalesce',
      }),
      node('W1', 'Manual', 'manualTrigger', 1, [0, 100], {}),
      node(
        'W1',
        'Any row',
        'dataTable',
        1.1,
        [220, 0],
        { resource: 'row', operation: 'get', dataTableId: VACANCIES, returnAll: false, limit: 1 },
        { alwaysOutputData: true },
      ),
      code('W1', 'Plan', 'n8n/w1-collector/plan.js', [440, 0]),
      node(
        'W1',
        'Search hh',
        'httpRequest',
        4.5,
        [660, 0],
        hhRequest({
          url: 'https://hh.ru/search/vacancy',
          query: [...SEARCH_QUERY, ['page', '={{ $json.page }}']],
          batching: true,
        }),
      ),
      code('W1', 'Parse search', 'n8n/w1-collector/parse-search.js', [880, 0]),
      node('W1', 'OK?', 'if', 2.3, [1100, 0], ifTrue('W1', '={{ $json.ok }}')),
      node('W1', 'Split vacancies', 'splitOut', 1, [1320, -100], {
        fieldToSplitOut: 'vacancies',
        include: 'noOtherFields',
        options: {},
      }),
      node('W1', 'Is new', 'dataTable', 1.1, [1540, -100], {
        resource: 'row',
        operation: 'rowNotExists',
        dataTableId: VACANCIES,
        matchType: 'anyCondition',
        filters: {
          conditions: [
            { keyName: 'external_id', keyValue: '={{ $json.external_id }}' },
            { keyName: 'dup_key', keyValue: '={{ $json.dup_key }}' },
          ],
        },
      }),
      node('W1', 'Insert', 'dataTable', 1.1, [1760, -100], {
        resource: 'row',
        operation: 'insert',
        dataTableId: VACANCIES,
        columns: {
          mappingMode: 'autoMapInputData',
          value: {},
          matchingColumns: [],
          schema: [],
          attemptToConvertTypes: false,
          convertFieldsToString: false,
        },
        options: {},
      }),
      code('W1', 'Format message', 'n8n/w1-collector/format-message.js', [1980, -100]),
      telegram('W1', 'Telegram', [2200, -100]),
      node('W1', 'To file', 'convertToFile', 1.1, [1320, 100], {
        operation: 'toText',
        sourceProperty: 'html',
        binaryPropertyName: 'data',
        options: { fileName: 'hh-fail.html' },
      }),
      node('W1', 'Save fixture', 'readWriteFile', 1.1, [1540, 100], {
        operation: 'write',
        fileName: "=/home/node/.n8n-files/fixtures/hh-fail-{{ $now.toFormat('yyyyLLdd-HHmmss') }}.html",
        dataPropertyName: 'data',
        options: {},
      }),
      node('W1', 'Stop', 'stopAndError', 1, [1760, 100], {
        errorType: 'errorMessage',
        errorMessage: "={{ $('Parse search').first().json.reason }}",
      }),
    ],
    [
      ['Schedule', 'Any row'],
      ['Manual', 'Any row'],
      ['Any row', 'Plan'],
      ['Plan', 'Search hh'],
      ['Search hh', 'Parse search'],
      ['Parse search', 'OK?'],
      ['OK?', 'Split vacancies', 0],
      ['Split vacancies', 'Is new'],
      ['Is new', 'Insert'],
      ['Insert', 'Format message'],
      ['Format message', 'Telegram'],
      ['OK?', 'To file', 1],
      ['To file', 'Save fixture'],
      ['Save fixture', 'Stop'],
    ],
    { timezone: 'Europe/Moscow', errorWorkflow: IDS.errors },
  ),

  'w4-errors': workflow(
    IDS.errors,
    'W4 Errors',
    [
      node('W4', 'Error Trigger', 'errorTrigger', 1, [0, 0], {}),
      code('W4', 'Format error', 'n8n/w4-errors/format-error.js', [220, 0]),
      telegram('W4', 'Telegram', [440, 0]),
    ],
    [
      ['Error Trigger', 'Format error'],
      ['Format error', 'Telegram'],
    ],
  ),
};

mkdirSync(`${ROOT}n8n/workflows`, { recursive: true });
for (const [file, wf] of Object.entries(workflows)) {
  writeFileSync(`${ROOT}n8n/workflows/${file}.json`, `${JSON.stringify(wf, null, 2)}\n`);
  console.log(`n8n/workflows/${file}.json  ${wf.name} (${wf.nodes.length} нод)`);
}
