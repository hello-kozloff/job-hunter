#!/usr/bin/env node
// Сборка JSON workflow для импорта в n8n.
// Код Code-нод берётся из n8n/<workflow>/*.js — единственный источник правды.
//
//   node scripts/build-workflows.mjs   →   n8n/workflows/*.json
//
// Импорт в локальный n8n: scripts/deploy.sh
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { TABLES } from '../n8n/schema.mjs';
import { readCode } from './lib/code.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
// Код Code-ноды: файл n8n/**/*.js, строки «// @include …» раскрываются (общий код карточки и т. п.)
const read = (path) => readCode(`${ROOT}${path}`);

// Постоянные id: повторный импорт обновляет те же workflow, а не создаёт копии
const IDS = {
  setup: 'jobHunterS0Setup',
  telegramTest: 'jobHunterS1TgTst',
  check: 'jobHunterW0Check',
  collector: 'jobHunterW1Colle',
  score: 'jobHunterW2Score',
  telegramBot: 'jobHunterW3Teleg',
  errors: 'jobHunterW4Error',
  letter: 'jobHunterW5Lettr',
  summary: 'jobHunterW6Summ1',
  n8nApiCredential: 'jobHunterN8nApi1',
  telegramCredential: 'jobHunterTgBot01',
  geminiCredential: 'jobHunterGemini1',
  claudeCredential: 'jobHunterClaude1',
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

const TELEGRAM_CREDENTIAL = { telegramApi: { id: IDS.telegramCredential, name: 'Telegram bot' } };

// Inline-клавиатура Telegram-ноды: rows = [[[текст, callback_data | { url }], …], …]
const keyboard = (rows) => ({
  rows: rows.map((buttons) => ({
    row: {
      buttons: buttons.map(([text, target]) => ({
        text,
        additionalFields: typeof target === 'object' ? target : { callback_data: target },
      })),
    },
  })),
});

// Ответ на нажатие кнопки (убирает «часики» на кнопке, показывает всплывающий текст)
const answerQuery = (wf, name, position, queryId, text) =>
  node(
    wf,
    name,
    'telegram',
    1.2,
    position,
    { resource: 'callback', operation: 'answerQuery', queryId, additionalFields: { text } },
    { credentials: TELEGRAM_CREDENTIAL },
  );

// Запуск другого workflow без ожидания (его ноде-триггеру «When Executed by Another Workflow»
// с «Accept all data» уходят items как есть)
const runWorkflow = (wf, name, position, workflowId) =>
  node(wf, name, 'executeWorkflow', 1.2, position, {
    source: 'database',
    workflowId: { __rl: true, mode: 'id', value: workflowId },
    mode: 'once',
    options: { waitForSubWorkflow: false },
  });

// Отправка сообщения: HTML, без подписи n8n и без превью ссылок
const telegram = (wf, name, position, { text = '={{ $json.text }}', fields = {}, markup, extra = {} } = {}) =>
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
      text,
      ...(markup ?? {}),
      additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true, ...fields },
    },
    { credentials: TELEGRAM_CREDENTIAL, ...extra },
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
const BLACKLIST = { __rl: true, mode: 'name', value: 'blacklist' };

// Insert/Update пишут все поля item в одноимённые колонки
const AUTO_MAP = {
  mappingMode: 'autoMapInputData',
  value: {},
  matchingColumns: [],
  schema: [],
  attemptToConvertTypes: false,
  convertFieldsToString: false,
};

// Update только перечисленных колонок: { колонка: выражение }
const COLUMN_TYPES = Object.fromEntries(TABLES.vacancies);
const setColumns = (values) => ({
  mappingMode: 'defineBelow',
  value: values,
  matchingColumns: [],
  schema: Object.keys(values).map((id) => ({
    id,
    displayName: id,
    required: false,
    defaultMatch: false,
    display: true,
    type: COLUMN_TYPES[id] ?? 'string',
    readOnly: false,
    removed: false,
  })),
  attemptToConvertTypes: false,
  convertFieldsToString: false,
});

const byId = (expression) => ({
  matchType: 'allConditions',
  filters: { conditions: [{ keyName: 'id', keyValue: expression }] },
});

// Запрос к API нейросети: тело готовит «Build prompt» ($json.body), ответ разбирает «Parse verdict».
// Ключ — из credential n8n; полный ответ без исключений на 4xx/5xx, по одному запросу раз в interval мс
const llmRequest = ({ url, credential, headers = [], interval }) => ({
  method: 'POST',
  url,
  authentication: 'predefinedCredentialType',
  nodeCredentialType: credential,
  sendHeaders: headers.length > 0,
  ...(headers.length > 0 && { specifyHeaders: 'keypair', headerParameters: pairs(headers) }),
  sendBody: true,
  contentType: 'json',
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify($json.body) }}',
  options: {
    batching: { batch: { batchSize: 1, batchInterval: interval } },
    response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
    timeout: 60000,
  },
});

// W3: состояние после нажатия кнопки, которое посчитали ноды «Apply choice» и «Apply sent»
const CHOICE = "$('Apply choice').first().json";
const SENT = "$('Apply sent').first().json";

// Перерисовать сообщение в чате TG_CHAT_ID без кнопок (W6: устаревшие и закрытые карточки и письма).
// onError = continue: сообщение могли удалить — запись в таблицу важнее
const telegramEdit = (wf, name, position, { messageId, text }) =>
  node(
    wf,
    name,
    'telegram',
    1.2,
    position,
    {
      resource: 'message',
      operation: 'editMessageText',
      messageType: 'message',
      chatId: '={{ $env.TG_CHAT_ID }}',
      messageId,
      text,
      replyMarkup: 'none',
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true },
    },
    { credentials: TELEGRAM_CREDENTIAL, onError: 'continueRegularOutput' },
  );

// W3: перерисовать сообщение — текст и кнопки (rows = null — убрать все кнопки)
const editMessage = (name, position, { chatId, messageId, text, rows }) =>
  node(
    'W3',
    name,
    'telegram',
    1.2,
    position,
    {
      resource: 'message',
      operation: 'editMessageText',
      messageType: 'message',
      chatId,
      messageId,
      text,
      ...(rows ? { replyMarkup: 'inlineKeyboard', inlineKeyboard: keyboard(rows) } : { replyMarkup: 'none' }),
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true },
    },
    { credentials: TELEGRAM_CREDENTIAL },
  );

// W3: перерисовать карточку после нажатия. src — нода с chatId / messageId / text
const editCard = (name, position, rows, src = CHOICE, messageId = 'messageId') =>
  editMessage(name, position, {
    chatId: `={{ ${src}.chatId }}`,
    messageId: `={{ ${src}.${messageId} }}`,
    text: `={{ ${src}.text }}`,
    rows,
  });

// Кнопки под письмом (W5 «Send letter», W3 «Letter: restore»). src — выражение с id, apply_url, url
const letterButtons = (src) => [
  [
    ['📝 Отклик на hh', { url: `={{ ${src}.apply_url }}` }],
    ['🔗 Вакансия', { url: `={{ ${src}.url }}` }],
  ],
  [
    ['🔄 Переписать', `=l:{{ ${src}.id }}:redo`],
    ['📨 Отправил', `=l:{{ ${src}.id }}:sent`],
  ],
];

// ---------- Workflow ----------

const workflows = {
  's0-setup': workflow(
    IDS.setup,
    'S0 Setup',
    [
      node('S0', 'Manual', 'manualTrigger', 1, [0, 0], {}),
      ...Object.entries(TABLES).map(([table, columns], i) =>
        node('S0', `Create ${table}`, 'dataTable', 1.1, [220 * (i + 1), 0], {
          resource: 'table',
          operation: 'create',
          tableName: table,
          columns: { column: columns.map(([name, type]) => ({ name, type })) },
          options: { createIfNotExists: true },
        }),
      ),
    ],
    Object.keys(TABLES).map((table, i, all) => [i === 0 ? 'Manual' : `Create ${all[i - 1]}`, `Create ${table}`]),
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
      // МСК: днём 07:00–17:30 каждые 30 мин, ночью 18, 20, 22, 00, 02, 04, 06 — 29 сборов в сутки
      // (решение пользователя 07.10.2026). Меняешь расписание — поправь isCollectSlot в n8n/w6-summary/summary.js
      node('W1', 'Schedule', 'scheduleTrigger', 1.4, [0, -100], {
        rule: {
          interval: [
            { field: 'cronExpression', expression: '0,30 7-17 * * *' },
            { field: 'cronExpression', expression: '0 0,2,4,6,18,20,22 * * *' },
          ],
        },
        // Mac спал во время запуска → после пробуждения выполнить последний пропущенный.
        // coalesce_owner — один догоняющий запуск на всю ноду: с coalesce (на каждое правило) сон через 18:00
        // запустил бы W1 дважды параллельно → дубли строк и карточек
        misfirePolicy: 'coalesce_owner',
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
      // Сигнал стражу healthchecks.io: поиск прошёл. Нет сигнала дольше нормы — страж сам пишет в Telegram
      node('W1', 'HC ping?', 'if', 2.3, [1320, -300], ifTrue('W1', '={{ Boolean($env.HC_PING_URL) }}')),
      node(
        'W1',
        'HC ping',
        'httpRequest',
        4.5,
        [1540, -300],
        { method: 'GET', url: '={{ $env.HC_PING_URL }}', options: { timeout: 10000 } },
        { onError: 'continueRegularOutput' },
      ),
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
      node(
        'W1',
        'Blacklist',
        'dataTable',
        1.1,
        [1760, -100],
        { resource: 'row', operation: 'get', dataTableId: BLACKLIST, returnAll: true },
        { executeOnce: true, alwaysOutputData: true },
      ),
      code('W1', 'Filter search', 'n8n/w1-collector/filter-search.js', [1980, -100]),
      node('W1', 'Insert', 'dataTable', 1.1, [2200, -100], {
        resource: 'row',
        operation: 'insert',
        dataTableId: VACANCIES,
        columns: AUTO_MAP,
        options: {},
      }),
      node('W1', 'Is candidate', 'if', 2.3, [2420, -100], ifTrue('W1', "={{ $json.status === 'new' }}")),
      node(
        'W1',
        'Vacancy page',
        'httpRequest',
        4.5,
        [2640, -200],
        hhRequest({
          url: '={{ $json.url }}',
          headers: [...BROWSER_HEADERS, ['Referer', 'https://hh.ru/search/vacancy']],
          batching: true,
        }),
      ),
      code('W1', 'Parse vacancy', 'n8n/w1-collector/parse-vacancy.js', [2860, -200]),
      node('W1', 'Update', 'dataTable', 1.1, [3080, -200], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        matchType: 'allConditions',
        filters: { conditions: [{ keyName: 'id', keyValue: '={{ $json.id }}' }] },
        columns: AUTO_MAP,
        options: {},
      }),
      // Оценка сразу после сбора. Ниже ветки вакансий: n8n (execution order v1) выполняет её последней,
      // когда новые вакансии уже detailed. Вызывается на каждом успешном сборе — так дооцениваются и хвосты после сбоев
      code('W1', 'Score job', 'n8n/w1-collector/score-job.js', [1320, 0]),
      runWorkflow('W1', 'Score', [1540, 0], IDS.score),
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
      ['OK?', 'HC ping?', 0],
      ['HC ping?', 'HC ping', 0],
      ['Split vacancies', 'Is new'],
      ['Is new', 'Blacklist'],
      ['Blacklist', 'Filter search'],
      ['Filter search', 'Insert'],
      ['Insert', 'Is candidate'],
      ['Is candidate', 'Vacancy page', 0],
      ['Vacancy page', 'Parse vacancy'],
      ['Parse vacancy', 'Update'],
      ['OK?', 'Score job', 0],
      ['Score job', 'Score'],
      ['OK?', 'To file', 1],
      ['To file', 'Save fixture'],
      ['Save fixture', 'Stop'],
    ],
    { timezone: 'Europe/Moscow', errorWorkflow: IDS.errors },
  ),

  'w2-score': workflow(
    IDS.score,
    'W2 Score',
    [
      // Вызов из W1 после каждого успешного сбора: новые вакансии уже прошли фильтр и лежат со status = detailed
      node('W2', 'Called by W1', 'executeWorkflowTrigger', 1.1, [0, -100], { inputSource: 'passthrough' }),
      node('W2', 'Manual', 'manualTrigger', 1, [0, 100], {}),
      node('W2', 'Pending', 'dataTable', 1.1, [220, 0], {
        resource: 'row',
        operation: 'get',
        dataTableId: VACANCIES,
        matchType: 'allConditions',
        filters: { conditions: [{ keyName: 'status', keyValue: 'detailed' }] },
        returnAll: false,
        // Лимит на запуск: бесплатный Gemini — несколько сотен запросов в день
        limit: 40,
        orderBy: true,
        orderByColumn: 'createdAt',
        orderByDirection: 'ASC',
      }),
      node(
        'W2',
        'Resume',
        'readWriteFile',
        1.1,
        [440, 0],
        { operation: 'read', fileSelector: '/home/node/.n8n-files/docs/resume.md', options: {} },
        { executeOnce: true },
      ),
      node('W2', 'Resume text', 'extractFromFile', 1.1, [660, 0], {
        operation: 'text',
        binaryPropertyName: 'data',
        destinationKey: 'resume',
        options: {},
      }),
      code('W2', 'Build prompt', 'n8n/w2-score/build-prompt.js', [880, 0]),
      node('W2', 'Claude?', 'if', 2.3, [1100, 0], ifTrue('W2', "={{ $json.provider === 'claude' }}")),
      node(
        'W2',
        'Claude',
        'httpRequest',
        4.5,
        [1320, -100],
        llmRequest({
          url: 'https://api.anthropic.com/v1/messages',
          credential: 'anthropicApi',
          headers: [['anthropic-version', '2023-06-01']],
          interval: 1000,
        }),
        { credentials: { anthropicApi: { id: IDS.claudeCredential, name: 'Claude' } }, onError: 'continueRegularOutput' },
      ),
      node(
        'W2',
        'Gemini',
        'httpRequest',
        4.5,
        [1320, 100],
        llmRequest({
          url: '=https://generativelanguage.googleapis.com/v1beta/models/{{ $json.model }}:generateContent',
          credential: 'googlePalmApi',
          // Бесплатный Gemini: 10–15 запросов в минуту → не чаще одного в 7 с
          interval: 7000,
        }),
        { credentials: { googlePalmApi: { id: IDS.geminiCredential, name: 'Gemini' } }, onError: 'continueRegularOutput' },
      ),
      code('W2', 'Parse verdict', 'n8n/w2-score/parse-verdict.js', [1540, 0]),
      // Ветка карточек выше ветки сводки: n8n (execution order v1) выполняет её первой
      code('W2', 'Format card', 'n8n/w2-score/format-card.js', [1760, -100]),
      telegram('W2', 'Send card', [1980, -100], {
        markup: {
          replyMarkup: 'inlineKeyboard',
          inlineKeyboard: keyboard([
            [
              ['✅ Откликнусь', '=v:{{ $json.id }}:apply'],
              ['🤔 Возможно', '=v:{{ $json.id }}:maybe'],
              ['❌ Мимо', '=v:{{ $json.id }}:skip'],
            ],
          ]),
        },
        fields: { disable_notification: '={{ $json.silent }}' },
        // Ошибка одной карточки не должна терять остальные: Card sent запишет только отправленные
        extra: { onError: 'continueRegularOutput' },
      }),
      code('W2', 'Card sent', 'n8n/w2-score/card-sent.js', [2200, -100]),
      node('W2', 'Save cards', 'dataTable', 1.1, [2420, -100], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: AUTO_MAP,
        options: {},
      }),
      node(
        'W2',
        'Recent rejects',
        'dataTable',
        1.1,
        [1760, 150],
        {
          resource: 'row',
          operation: 'get',
          dataTableId: VACANCIES,
          matchType: 'allConditions',
          filters: { conditions: [{ keyName: 'status', keyValue: 'rejected' }] },
          returnAll: false,
          limit: 100,
          orderBy: true,
          orderByColumn: 'updatedAt',
          orderByDirection: 'DESC',
        },
        { executeOnce: true, alwaysOutputData: true },
      ),
      code('W2', 'Summary', 'n8n/w2-score/summary.js', [1980, 150]),
      telegram('W2', 'Send summary', [2200, 150], { fields: { disable_notification: '={{ $json.silent }}' } }),
    ],
    [
      ['Called by W1', 'Pending'],
      ['Manual', 'Pending'],
      ['Pending', 'Resume'],
      ['Resume', 'Resume text'],
      ['Resume text', 'Build prompt'],
      ['Build prompt', 'Claude?'],
      ['Claude?', 'Claude', 0],
      ['Claude?', 'Gemini', 1],
      ['Claude', 'Parse verdict'],
      ['Gemini', 'Parse verdict'],
      ['Parse verdict', 'Format card'],
      ['Parse verdict', 'Recent rejects'],
      ['Format card', 'Send card'],
      ['Send card', 'Card sent'],
      ['Card sent', 'Save cards'],
      ['Recent rejects', 'Summary'],
      ['Summary', 'Send summary'],
    ],
    { timezone: 'Europe/Moscow', errorWorkflow: IDS.errors },
  ),

  'w3-telegram': workflow(
    IDS.telegramBot,
    'W3 Telegram',
    [
      node(
        'W3',
        'Telegram Trigger',
        'telegramTrigger',
        1.5,
        [0, 0],
        { updates: ['callback_query', 'message'], additionalFields: { chatIds: '={{ $env.TG_CHAT_ID }}' } },
        { webhookId: uuid('W3/telegram-trigger'), credentials: TELEGRAM_CREDENTIAL },
      ),
      code('W3', 'Route', 'n8n/w3-telegram/route.js', [220, 0]),
      node('W3', 'Button?', 'if', 2.3, [440, 0], ifTrue('W3', "={{ $json.action === 'choice' }}")),
      // Кнопка на карточке
      node('W3', 'Vacancy', 'dataTable', 1.1, [660, -100], {
        resource: 'row',
        operation: 'get',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        returnAll: false,
        limit: 1,
      }),
      code('W3', 'Apply choice', 'n8n/w3-telegram/apply-choice.js', [880, -100]),
      node('W3', 'Save choice', 'dataTable', 1.1, [1100, -100], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: setColumns({ my_decision: '={{ $json.my_decision }}', status: '={{ $json.status }}' }),
        options: {},
      }),
      node(
        'W3',
        'Answer',
        'telegram',
        1.2,
        [1320, -100],
        {
          resource: 'callback',
          operation: 'answerQuery',
          queryId: `={{ ${CHOICE}.queryId }}`,
          additionalFields: { text: `={{ ${CHOICE}.toast }}` },
        },
        { credentials: TELEGRAM_CREDENTIAL },
      ),
      node('W3', 'Decided?', 'if', 2.3, [1540, -100], ifTrue('W3', `={{ ${CHOICE}.keyboard === 'decided' }}`)),
      editCard('Card: decided', [1760, -200], [[['↩️ Изменить', `=v:{{ ${CHOICE}.id }}:edit`]]]),
      editCard('Card: choose', [1760, 0], [
        [
          ['✅ Откликнусь', `=v:{{ ${CHOICE}.id }}:apply`],
          ['🤔 Возможно', `=v:{{ ${CHOICE}.id }}:maybe`],
          ['❌ Мимо', `=v:{{ ${CHOICE}.id }}:skip`],
        ],
      ]),
      node('W3', 'Ask?', 'if', 2.3, [1980, -200], ifTrue('W3', `={{ Boolean(${CHOICE}.ask) }}`)),
      telegram('W3', 'Ask why', [2200, -200], {
        text: `={{ ${CHOICE}.ask }}`,
        fields: { reply_to_message_id: `={{ ${CHOICE}.messageId }}` },
        markup: { replyMarkup: 'forceReply', forceReply: { force_reply: true } },
      }),
      node('W3', 'Save ask', 'dataTable', 1.1, [2420, -200], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId(`={{ ${CHOICE}.id }}`),
        columns: setColumns({ tg_ask_id: '={{ $json.result.message_id }}' }),
        options: {},
      }),
      // ✅ и письма ещё нет → письмо (W5). Ветка ниже «Ask?»: вопрос «почему?» уходит первым
      node('W3', 'Letter?', 'if', 2.3, [1980, -50], ifTrue('W3', `={{ ${CHOICE}.need_letter }}`)),
      // Кнопки под письмом: «🔄 Переписать» и «📨 Отправил»
      node('W3', 'Letter button?', 'if', 2.3, [660, 250], ifTrue('W3', "={{ $json.action === 'letter' }}")),
      node('W3', 'Redo?', 'if', 2.3, [880, 200], ifTrue('W3', "={{ $json.op === 'redo' }}")),
      answerQuery('W3', 'Answer redo', [1100, 150], "={{ $('Route').first().json.queryId }}", '✍️ Пишу новый вариант…'),
      node('W3', 'Sent row', 'dataTable', 1.1, [1100, 300], {
        resource: 'row',
        operation: 'get',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        returnAll: false,
        limit: 1,
      }),
      code('W3', 'Apply sent', 'n8n/w3-telegram/apply-sent.js', [1320, 300]),
      node('W3', 'Save sent', 'dataTable', 1.1, [1540, 300], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: setColumns({ status: '={{ $json.status }}', applied_at: '={{ $json.applied_at }}' }),
        options: {},
      }),
      answerQuery('W3', 'Answer sent', [1760, 300], `={{ ${SENT}.queryId }}`, `={{ ${SENT}.toast }}`),
      node('W3', 'Sent?', 'if', 2.3, [1980, 300], ifTrue('W3', `={{ ${SENT}.sent }}`)),
      // «📨 Отправил»: у письма — только «↩️ Отменить», у карточки кнопок нет
      editMessage('Letter: sent', [2200, 250], {
        chatId: `={{ ${SENT}.chatId }}`,
        messageId: `={{ ${SENT}.letterMessageId }}`,
        text: `={{ ${SENT}.letterText }}`,
        rows: [[['↩️ Отменить', `=l:{{ ${SENT}.id }}:unsent`]]],
      }),
      editMessage('Card: sent', [2420, 250], {
        chatId: `={{ ${SENT}.chatId }}`,
        messageId: `={{ ${SENT}.cardId }}`,
        text: `={{ ${SENT}.cardText }}`,
        rows: null,
      }),
      // «↩️ Отменить»: письму возвращаются все кнопки, карточке — «↩️ Изменить»
      editMessage('Letter: restore', [2200, 400], {
        chatId: `={{ ${SENT}.chatId }}`,
        messageId: `={{ ${SENT}.letterMessageId }}`,
        text: `={{ ${SENT}.letterText }}`,
        rows: letterButtons(SENT),
      }),
      editMessage('Card: restore', [2420, 400], {
        chatId: `={{ ${SENT}.chatId }}`,
        messageId: `={{ ${SENT}.cardId }}`,
        text: `={{ ${SENT}.cardText }}`,
        rows: [[['↩️ Изменить', `=v:{{ ${SENT}.id }}:edit`]]],
      }),
      // Ответ (reply): на письмо — правка письма, на вопрос «почему?» или карточку — причина
      node('W3', 'Reply row', 'dataTable', 1.1, [880, 500], {
        resource: 'row',
        operation: 'get',
        dataTableId: VACANCIES,
        matchType: 'anyCondition',
        filters: {
          conditions: [
            { keyName: 'tg_letter_id', keyValue: '={{ $json.replyTo }}' },
            { keyName: 'tg_ask_id', keyValue: '={{ $json.replyTo }}' },
            { keyName: 'tg_message_id', keyValue: '={{ $json.replyTo }}' },
          ],
        },
        returnAll: false,
        limit: 1,
      }),
      code('W3', 'Reply kind', 'n8n/w3-telegram/reply-kind.js', [1100, 500]),
      node('W3', 'Revise?', 'if', 2.3, [1320, 500], ifTrue('W3', "={{ $json.kind === 'revise' }}")),
      node('W3', 'Save reason', 'dataTable', 1.1, [1540, 600], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: setColumns({ my_reason: '={{ $json.text }}' }),
        options: {},
      }),
      telegram('W3', 'Confirm', [1760, 600], {
        text: '✍️ Записал причину',
        fields: { reply_to_message_id: "={{ $('Route').first().json.messageId }}", disable_notification: true },
      }),
      // Письмо: одна нода на три ветки (✅, «🔄 Переписать», ответ на письмо) → W5 Letter
      code('W3', 'Letter job', 'n8n/w3-telegram/letter-job.js', [2200, 100]),
      runWorkflow('W3', 'Write letter', [2420, 100], IDS.letter),
    ],
    [
      ['Telegram Trigger', 'Route'],
      ['Route', 'Button?'],
      ['Button?', 'Vacancy', 0],
      ['Vacancy', 'Apply choice'],
      ['Apply choice', 'Save choice'],
      ['Save choice', 'Answer'],
      ['Answer', 'Decided?'],
      ['Decided?', 'Card: decided', 0],
      ['Decided?', 'Card: choose', 1],
      ['Card: decided', 'Ask?'],
      ['Ask?', 'Ask why', 0],
      ['Ask why', 'Save ask'],
      ['Card: decided', 'Letter?'],
      ['Letter?', 'Letter job', 0],
      ['Button?', 'Letter button?', 1],
      ['Letter button?', 'Redo?', 0],
      ['Redo?', 'Answer redo', 0],
      ['Answer redo', 'Letter job'],
      ['Redo?', 'Sent row', 1],
      ['Sent row', 'Apply sent'],
      ['Apply sent', 'Save sent'],
      ['Save sent', 'Answer sent'],
      ['Answer sent', 'Sent?'],
      ['Sent?', 'Letter: sent', 0],
      ['Letter: sent', 'Card: sent'],
      ['Sent?', 'Letter: restore', 1],
      ['Letter: restore', 'Card: restore'],
      ['Letter button?', 'Reply row', 1],
      ['Reply row', 'Reply kind'],
      ['Reply kind', 'Revise?'],
      ['Revise?', 'Letter job', 0],
      ['Revise?', 'Save reason', 1],
      ['Save reason', 'Confirm'],
      ['Letter job', 'Write letter'],
    ],
    { errorWorkflow: IDS.errors },
  ),

  'w5-letter': workflow(
    IDS.letter,
    'W5 Letter',
    [
      // Вызов из W3 (✅, «🔄 Переписать», ответ на письмо): items { id, letter_mode, instruction }
      node('W5', 'Called by W3', 'executeWorkflowTrigger', 1.1, [0, -100], { inputSource: 'passthrough' }),
      // Ручной запуск — письма ко всем ✅ без письма
      node('W5', 'Manual', 'manualTrigger', 1, [0, 100], {}),
      node('W5', 'Approved', 'dataTable', 1.1, [220, 100], {
        resource: 'row',
        operation: 'get',
        dataTableId: VACANCIES,
        matchType: 'allConditions',
        filters: {
          conditions: [
            { keyName: 'status', keyValue: 'approved' },
            { keyName: 'letter', condition: 'isEmpty' },
          ],
        },
        returnAll: true,
      }),
      code('W5', 'Jobs', 'n8n/w5-letter/jobs.js', [440, 0]),
      node('W5', 'Vacancy', 'dataTable', 1.1, [660, 0], {
        resource: 'row',
        operation: 'get',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        returnAll: false,
        limit: 1,
      }),
      node(
        'W5',
        'Resume',
        'readWriteFile',
        1.1,
        [880, 0],
        { operation: 'read', fileSelector: '/home/node/.n8n-files/docs/resume.md', options: {} },
        { executeOnce: true },
      ),
      node('W5', 'Resume text', 'extractFromFile', 1.1, [1100, 0], {
        operation: 'text',
        binaryPropertyName: 'data',
        destinationKey: 'resume',
        options: {},
      }),
      node(
        'W5',
        'Example',
        'readWriteFile',
        1.1,
        [1320, 0],
        { operation: 'read', fileSelector: '/home/node/.n8n-files/docs/letter-example.md', options: {} },
        { executeOnce: true },
      ),
      node('W5', 'Example text', 'extractFromFile', 1.1, [1540, 0], {
        operation: 'text',
        binaryPropertyName: 'data',
        destinationKey: 'example',
        options: {},
      }),
      code('W5', 'Build letter', 'n8n/w5-letter/build-letter.js', [1760, 0]),
      node('W5', 'Claude?', 'if', 2.3, [1980, 0], ifTrue('W5', "={{ $json.provider === 'claude' }}")),
      node(
        'W5',
        'Claude',
        'httpRequest',
        4.5,
        [2200, -100],
        llmRequest({
          url: 'https://api.anthropic.com/v1/messages',
          credential: 'anthropicApi',
          headers: [['anthropic-version', '2023-06-01']],
          interval: 1000,
        }),
        { credentials: { anthropicApi: { id: IDS.claudeCredential, name: 'Claude' } }, onError: 'continueRegularOutput' },
      ),
      node(
        'W5',
        'Gemini',
        'httpRequest',
        4.5,
        [2200, 100],
        llmRequest({
          url: '=https://generativelanguage.googleapis.com/v1beta/models/{{ $json.model }}:generateContent',
          credential: 'googlePalmApi',
          interval: 5000,
        }),
        { credentials: { googlePalmApi: { id: IDS.geminiCredential, name: 'Gemini' } }, onError: 'continueRegularOutput' },
      ),
      code('W5', 'Parse letter', 'n8n/w5-letter/parse-letter.js', [2420, 0]),
      code('W5', 'Format letter', 'n8n/w5-letter/format-letter.js', [2640, 0]),
      telegram('W5', 'Send letter', [2860, 0], {
        markup: {
          replyMarkup: 'inlineKeyboard',
          inlineKeyboard: keyboard(letterButtons('$json')),
        },
        fields: { reply_to_message_id: '={{ $json.replyTo }}' },
        extra: { onError: 'continueRegularOutput' },
      }),
      code('W5', 'Letter sent', 'n8n/w5-letter/letter-sent.js', [3080, 0]),
      node('W5', 'Save letter', 'dataTable', 1.1, [3300, 0], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: AUTO_MAP,
        options: {},
      }),
    ],
    [
      ['Called by W3', 'Jobs'],
      ['Manual', 'Approved'],
      ['Approved', 'Jobs'],
      ['Jobs', 'Vacancy'],
      ['Vacancy', 'Resume'],
      ['Resume', 'Resume text'],
      ['Resume text', 'Example'],
      ['Example', 'Example text'],
      ['Example text', 'Build letter'],
      ['Build letter', 'Claude?'],
      ['Claude?', 'Claude', 0],
      ['Claude?', 'Gemini', 1],
      ['Claude', 'Parse letter'],
      ['Gemini', 'Parse letter'],
      ['Parse letter', 'Format letter'],
      ['Format letter', 'Send letter'],
      ['Send letter', 'Letter sent'],
      ['Letter sent', 'Save letter'],
    ],
    { errorWorkflow: IDS.errors },
  ),

  'w6-summary': workflow(
    IDS.summary,
    'W6 Summary',
    [
      node('W6', 'Schedule', 'scheduleTrigger', 1.4, [0, -100], {
        // 06:00 МСК = 10:00 по Таиланду: итог прошедших суток
        rule: { interval: [{ field: 'cronExpression', expression: '0 6 * * *' }] },
        misfirePolicy: 'coalesce',
      }),
      node('W6', 'Manual', 'manualTrigger', 1, [0, 100], {}),
      node('W6', 'All rows', 'dataTable', 1.1, [220, 0], {
        resource: 'row',
        operation: 'get',
        dataTableId: VACANCIES,
        returnAll: true,
      }),
      code('W6', 'Plan', 'n8n/w6-summary/plan.js', [440, 0]),
      // Ветки по порядку сверху вниз: устаревшие → закрытые на hh → сводка
      code('W6', 'Expire rows', 'n8n/w6-summary/expire-rows.js', [660, -300]),
      telegramEdit('W6', 'Card: expired', [880, -300], { messageId: '={{ $json.tg_message_id }}', text: '={{ $json.text }}' }),
      code('W6', 'Expired done', 'n8n/w6-summary/expired-done.js', [1100, -300]),
      node('W6', 'Save expired', 'dataTable', 1.1, [1320, -300], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: AUTO_MAP,
        options: {},
      }),
      code('W6', 'Check candidates', 'n8n/w6-summary/check-candidates.js', [660, -50]),
      node(
        'W6',
        'Vacancy page',
        'httpRequest',
        4.5,
        [880, -50],
        hhRequest({
          url: '={{ $json.url }}',
          headers: [...BROWSER_HEADERS, ['Referer', 'https://hh.ru/search/vacancy']],
          batching: true,
        }),
        { onError: 'continueRegularOutput' },
      ),
      code('W6', 'Archive status', 'n8n/w6-summary/archive-status.js', [1100, -50]),
      telegramEdit('W6', 'Card: archived', [1320, -100], { messageId: '={{ $json.tg_message_id }}', text: '={{ $json.cardText }}' }),
      code('W6', 'Archived done', 'n8n/w6-summary/archived-done.js', [1540, -100]),
      node('W6', 'Save archived', 'dataTable', 1.1, [1760, -100], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: AUTO_MAP,
        options: {},
      }),
      node('W6', 'Has letter?', 'if', 2.3, [1320, 50], ifTrue('W6', '={{ Boolean($json.tg_letter_id) }}')),
      telegramEdit('W6', 'Letter: archived', [1540, 50], { messageId: '={{ $json.tg_letter_id }}', text: '={{ $json.letterText }}' }),
      // Запуски n8n за сутки — публичный API (ключ в credential «n8n API»)
      node(
        'W6',
        'Executions',
        'httpRequest',
        4.5,
        [660, 250],
        {
          method: 'GET',
          url: 'http://localhost:5678/api/v1/executions',
          authentication: 'predefinedCredentialType',
          nodeCredentialType: 'n8nApi',
          sendQuery: true,
          specifyQuery: 'keypair',
          queryParameters: pairs([['limit', '250']]),
          options: { timeout: 30000 },
        },
        {
          credentials: { n8nApi: { id: IDS.n8nApiCredential, name: 'n8n API' } },
          onError: 'continueRegularOutput',
          executeOnce: true,
        },
      ),
      // Туннель ngrok жив, если снаружи отвечает 403: политика не пускает адреса не из Telegram
      node(
        'W6',
        'Tunnel',
        'httpRequest',
        4.5,
        [880, 250],
        {
          method: 'GET',
          url: '=https://{{ $env.NGROK_DOMAIN }}/',
          options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } }, timeout: 15000 },
        },
        { onError: 'continueRegularOutput' },
      ),
      code('W6', 'Summary', 'n8n/w6-summary/summary.js', [1100, 250]),
      telegram('W6', 'Send summary', [1320, 250], { fields: { disable_notification: '={{ $json.silent }}' } }),
    ],
    [
      ['Schedule', 'All rows'],
      ['Manual', 'All rows'],
      ['All rows', 'Plan'],
      ['Plan', 'Expire rows'],
      ['Expire rows', 'Card: expired'],
      ['Card: expired', 'Expired done'],
      ['Expired done', 'Save expired'],
      ['Plan', 'Check candidates'],
      ['Check candidates', 'Vacancy page'],
      ['Vacancy page', 'Archive status'],
      ['Archive status', 'Card: archived'],
      ['Card: archived', 'Archived done'],
      ['Archived done', 'Save archived'],
      ['Archive status', 'Has letter?'],
      ['Has letter?', 'Letter: archived', 0],
      ['Plan', 'Executions'],
      ['Executions', 'Tunnel'],
      ['Tunnel', 'Summary'],
      ['Summary', 'Send summary'],
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
