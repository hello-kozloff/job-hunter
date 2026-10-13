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
  menu: 'jobHunterW7Menu1',
  clock: 'jobHunterW8Clock',
  // Робот-отклик (этап 6, docs/stages/stage-6.md): очередь 🚀, капча, блоки
  robot: 'jobHunterW9Robot',
  n8nApiCredential: 'jobHunterN8nApi1',
  // Ключ API healthchecks.io (HC_API_KEY в .env) — бот обновляет расписание стража (07.10.2026)
  hcCredential: 'jobHunterHcApi01',
  telegramCredential: 'jobHunterTgBot01',
  geminiCredential: 'jobHunterGemini1',
  claudeCredential: 'jobHunterClaude1',
  // Токен API робота-отклика (APPLIER_TOKEN в .env) — заголовок X-Applier-Token
  applierCredential: 'jobHunterApplier',
};

const uuid = (seed) => {
  const h = createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

// Telegram-нода повторяет запрос: сеть до api.telegram.org иногда рвётся на TLS-рукопожатии (ECONNRESET,
// 13.10.2026 — W7 «New: open choose»), запрос до Telegram не доходит, второй проходит. Только у нод без onError:
// у остальных ошибка ожидаема («message is not modified», сообщение удалено), повтор лишь задержал бы ответ
const TG_RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };

const node = (wf, name, type, typeVersion, position, parameters, extra = {}) => ({
  id: uuid(`${wf}/${name}`),
  name,
  type: `n8n-nodes-base.${type}`,
  typeVersion,
  position,
  parameters,
  ...(type === 'telegram' && !extra.onError && TG_RETRY),
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

// Поисковый запрос hh — из n8n/shared/search.js. Слова и период — настройки бота (⚙️ → 🔎 Поиск):
// W1 «Plan» берёт их из таблицы settings, W0 (ручная проверка) — значения по умолчанию
const { SEARCH_URL, searchQuery, loadSettings } = new Function(
  `${read('n8n/shared/settings.js')}\n${read('n8n/shared/search.js')}\nreturn { SEARCH_URL, searchQuery, loadSettings };`,
)();
const SEARCH_QUERY = searchQuery(loadSettings([]));

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

// Клавиатура под полем ввода (reply keyboard): rows = [[текст, …], …]. Нажатие присылает текст сообщением
const replyKeyboard = (rows) => ({
  rows: rows.map((buttons) => ({ row: { buttons: buttons.map((text) => ({ text })) } })),
});

// Подписи кнопок меню — из n8n/shared/menu.js (по ним W3 «Route» узнаёт нажатие)
const { MENU } = new Function(`${read('n8n/shared/menu.js')}\nreturn { MENU };`)();

// Кнопки меню под полем ввода. Вопрос «Почему?» (force reply) их прячет, а вернуть их может только новое
// сообщение бота с этой клавиатурой — поэтому она едет с каждым простым сообщением: приветствие W7,
// «✍️ Записал причину» (W3), сообщение о сборе и итог после карточек (W2), утренняя сводка (W6)
const MENU_KEYBOARD = {
  replyMarkup: 'replyKeyboard',
  replyKeyboard: replyKeyboard([[MENU.list, MENU.stats], [MENU.settings]]),
  replyKeyboardOptions: { resize_keyboard: true },
};

// Ответ на нажатие кнопки (убирает «часики» на кнопке, показывает всплывающий текст)
const answerQuery = (wf, name, position, queryId, text, extra = {}) =>
  node(
    wf,
    name,
    'telegram',
    1.2,
    position,
    { resource: 'callback', operation: 'answerQuery', queryId, additionalFields: { text } },
    { credentials: TELEGRAM_CREDENTIAL, ...extra },
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
const RUNS = { __rl: true, mode: 'name', value: 'runs' };
const ALERTS = { __rl: true, mode: 'name', value: 'alerts' };
const SETTINGS_TABLE = { __rl: true, mode: 'name', value: 'settings' };
// Настройки бота (⚙️): все строки таблицы settings, один раз на запуск; пустая — значения по умолчанию
const settingsNode = (wf, position) =>
  node(
    wf,
    'Settings',
    'dataTable',
    1.1,
    position,
    { resource: 'row', operation: 'get', dataTableId: SETTINGS_TABLE, returnAll: true },
    { executeOnce: true, alwaysOutputData: true },
  );

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
const COLUMN_TYPES = Object.fromEntries(Object.values(TABLES).flat());
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

// W7: раскладки кнопок панели меню. Telegram-нода не умеет менять число кнопок на ходу, поэтому раскладки
// фиксированные, а подписи и callback_data считает «Render» ($json.b). Порядок = номера выходов «Layout»
const panelButton = (path) => `={{ $json.b.${path} }}`;
const PANEL_LAYOUTS = [
  [
    'list',
    [
      [0, 1, 2].map((i) => [panelButton(`tabs[${i}].text`), panelButton(`tabs[${i}].cb`)]),
      [3, 4, 5].map((i) => [panelButton(`tabs[${i}].text`), panelButton(`tabs[${i}].cb`)]),
      ['prev', 'mid', 'next'].map((k) => [panelButton(`${k}.text`), panelButton(`${k}.cb`)]),
    ],
  ],
  [
    'open choose',
    [
      [
        ['✅ Откликнусь', panelButton('apply')],
        ['🤔 Возможно', panelButton('maybe')],
        ['❌ Мимо', panelButton('skip')],
      ],
      [
        ['📨 Уже откликался', panelButton('earlier')],
        ['🚫 В ЧС', panelButton('ban')],
      ],
      [
        ['🔗 На hh', { url: panelButton('url') }],
        ['⬅️ К списку', panelButton('back')],
      ],
    ],
  ],
  [
    'open decided',
    [
      [
        ['↩️ Изменить', panelButton('edit')],
        ['🔗 На hh', { url: panelButton('url') }],
      ],
      [['⬅️ К списку', panelButton('back')]],
    ],
  ],
  [
    'open plain',
    [
      [
        ['🔗 На hh', { url: panelButton('url') }],
        ['⬅️ К списку', panelButton('back')],
      ],
    ],
  ],
  [
    'stats',
    [
      [
        ['🔄 Обновить', 'p:s'],
        [panelButton('wait.text'), panelButton('wait.cb')],
      ],
    ],
  ],
  // ⚙️ Настройки (07.10.2026): корень и разделы; «▸» — следующее значение по кругу
  [
    'settings',
    [
      [
        ['🕐 Сбор', panelButton('collect.cb')],
        ['🔎 Поиск', panelButton('search.cb')],
      ],
      [
        ['🧹 Фильтр', panelButton('filter.cb')],
        ['🤖 Нейросеть', panelButton('llm.cb')],
      ],
      // Робот-отклик (этап 6)
      [['🚀 Робот', panelButton('apply.cb')]],
    ],
  ],
  [
    'set collect',
    [
      [
        [panelButton('day.text'), panelButton('day.cb')],
        [panelButton('night.text'), panelButton('night.cb')],
      ],
      [[panelButton('window.text'), panelButton('window.cb')]],
      [
        [panelButton('pause.text'), panelButton('pause.cb')],
        ['🔄 Собрать сейчас', 'sn'],
      ],
      [['⬅️ Настройки', 's:root']],
    ],
  ],
  [
    'set search',
    [
      [[panelButton('period.text'), panelButton('period.cb')]],
      [
        ['✏️ Везде в тексте', 'sw:search.anywhere'],
        ['✏️ В названии', 'sw:search.in_name'],
      ],
      [
        ['🔗 Открыть поиск', { url: panelButton('url') }],
        ['⬅️ Настройки', 's:root'],
      ],
    ],
  ],
  [
    'set filter',
    [
      [
        [panelButton('responses.text'), panelButton('responses.cb')],
        ['✏️ Стоп-слова', 'sw:filter.stop_words'],
      ],
      [
        ['⚙️ Правила', 's:rules'],
        [panelButton('blacklist.text'), 's:blacklist'],
      ],
      [['⬅️ Настройки', 's:root']],
    ],
  ],
  // 10 правил фильтра (n8n/shared/settings.js → FILTER_RULES), по два в ряд
  [
    'set rules',
    [
      ...[0, 2, 4, 6, 8].map((i) => [
        [panelButton(`r${i}.text`), panelButton(`r${i}.cb`)],
        [panelButton(`r${i + 1}.text`), panelButton(`r${i + 1}.cb`)],
      ]),
      [['⬅️ Фильтр', 's:filter']],
    ],
  ],
  ['set blacklist', [[['⬅️ Фильтр', 's:filter']]]],
  [
    'set confirm',
    [
      [
        ['🗑 Убрать', panelButton('yes')],
        ['Отмена', 's:blacklist'],
      ],
    ],
  ],
  [
    'set llm',
    [
      [
        [panelButton('provider.text'), panelButton('provider.cb')],
        [panelButton('shadow.text'), panelButton('shadow.cb')],
      ],
      // Спорные случаи — списком «случай: решение» (решение пользователя 07.10.2026: текстом, а не кнопками)
      [['✏️ Спорные случаи', 'sw:llm.cases']],
      [['⬅️ Настройки', 's:root']],
    ],
  ],
  // Отсеянная фильтром (08.10.2026): решение без карточки в ленте или «🤖 На оценку» — вернуть нейросети
  [
    'open rescue',
    [
      [
        ['✅ Откликнусь', panelButton('apply')],
        ['🤔 Возможно', panelButton('maybe')],
        ['📨 Уже откликался', panelButton('earlier')],
      ],
      [['🤖 На оценку', panelButton('score')]],
      [
        ['🔗 На hh', { url: panelButton('url') }],
        ['⬅️ К списку', panelButton('back')],
      ],
    ],
  ],
  // ⚙️ → 🚀 Робот (этап 6): вкл/выкл, пауза очереди, лимит в день; ▶️ — продолжить после капчи или входа (W9)
  [
    'set apply',
    [
      [
        [panelButton('enabled.text'), panelButton('enabled.cb')],
        [panelButton('paused.text'), panelButton('paused.cb')],
      ],
      [[panelButton('limit.text'), panelButton('limit.cb')]],
      [
        ['▶️ Продолжить', 'rb:go'],
        ['⬅️ Настройки', 's:root'],
      ],
    ],
  ],
];

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

// Успешный запуск закрывает тревоги своего workflow (07.10.2026): «Open alerts» → «Recovered» («✅ снова работает»)
// → «Send recovered» → «Close alerts». Возвращает ноды и связи; from — нода, после которой идёт цепочка
const recoveryChain = (wf, workflowName, from, [x, y]) => {
  const openFilter = {
    matchType: 'allConditions',
    filters: {
      conditions: [
        { keyName: 'workflow', keyValue: workflowName },
        { keyName: 'is_open', condition: 'isTrue' },
      ],
    },
  };
  return {
    nodes: [
      node(
        wf,
        'Open alerts',
        'dataTable',
        1.1,
        [x, y],
        { resource: 'row', operation: 'get', dataTableId: ALERTS, ...openFilter, returnAll: true },
        { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' },
      ),
      code(wf, 'Recovered', 'n8n/w4-errors/recovered.js', [x + 220, y]),
      telegram(wf, 'Send recovered', [x + 440, y], { fields: { disable_notification: true } }),
      node(
        wf,
        'Close alerts',
        'dataTable',
        1.1,
        [x + 660, y],
        {
          resource: 'row',
          operation: 'update',
          dataTableId: ALERTS,
          ...openFilter,
          columns: setColumns({ is_open: '={{ false }}' }),
          options: {},
        },
        { onError: 'continueRegularOutput' },
      ),
    ],
    links: [
      [from, 'Open alerts'],
      ['Open alerts', 'Recovered'],
      ['Recovered', 'Send recovered'],
      ['Send recovered', 'Close alerts'],
    ],
  };
};
const W1_RECOVERY = recoveryChain('W1', 'W1 Collector', 'Finish run', [2420, 0]);
const W2_RECOVERY = recoveryChain('W2', 'W2 Score', 'Called by W1', [1980, 900]);

// Перерисовать сообщение — текст и кнопки (rows = null — убрать все кнопки). По умолчанию — нода W3
const editMessage = (name, position, { chatId, messageId, text, rows }, wf = 'W3', extra = {}) =>
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
      chatId,
      messageId,
      text,
      ...(rows ? { replyMarkup: 'inlineKeyboard', inlineKeyboard: keyboard(rows) } : { replyMarkup: 'none' }),
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true },
    },
    { credentials: TELEGRAM_CREDENTIAL, ...extra },
  );

// W3: правка карточки или письма после нажатия. Двойное нажатие (тот же вид) → Telegram «message is not
// modified» — не ошибка (как правка панели в W7); ноды ниже читают Apply choice / Apply sent, не $json
const editW3 = (name, position, params) =>
  editMessage(name, position, params, 'W3', { onError: 'continueRegularOutput' });

// W3: перерисовать карточку после нажатия. src — нода с chatId / messageId / text
const editCard = (name, position, rows, src = CHOICE, messageId = 'messageId') =>
  editW3(name, position, {
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

// ---------- Робот-отклик (этап 6, docs/stages/stage-6.md) ----------

// Робот — сервис applier в том же docker compose (applier/src/server.mjs)
const APPLIER = 'http://applier:3000';
const APPLIER_CREDENTIAL = { httpHeaderAuth: { id: IDS.applierCredential, name: 'Applier' } };

// Запрос к роботу. full — полный ответ без исключений (коды 409 / 423 / 429 — часть контракта), иначе — тело ответа;
// file — ответ файлом в binary «data» (скриншот). Нет связи — item { error } (onError: continue)
const applierNode = (wf, name, position, { method = 'GET', path, body, timeout = 10000, full = false, file = false }, extra = {}) =>
  node(
    wf,
    name,
    'httpRequest',
    4.5,
    position,
    {
      method,
      url: `=${APPLIER}${path}`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      ...(body && { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: body }),
      options: {
        response: {
          response: file
            ? { responseFormat: 'file' }
            : { fullResponse: full, neverError: true, responseFormat: 'json' },
        },
        timeout,
      },
    },
    { credentials: APPLIER_CREDENTIAL, onError: 'continueRegularOutput', ...extra },
  );

// Фото из binary «data» (скриншот робота): подпись HTML; reply, звук — в fields
const sendPhoto = (wf, name, position, { caption, fields = {}, markup, extra = {} }) =>
  node(
    wf,
    name,
    'telegram',
    1.2,
    position,
    {
      resource: 'message',
      operation: 'sendPhoto',
      chatId: '={{ $env.TG_CHAT_ID }}',
      binaryData: true,
      binaryPropertyName: 'data',
      ...(markup ?? {}),
      additionalFields: { caption, parse_mode: 'HTML', fileName: 'shot.jpg', ...fields },
    },
    { credentials: TELEGRAM_CREDENTIAL, onError: 'continueRegularOutput', ...extra },
  );

// Кнопки письма с роботом: [🚀 Откликнуться роботом] сверху (решение пользователя 10.10.2026)
const robotLetterButtons = (src) => [[['🚀 Откликнуться роботом', `=l:{{ ${src}.id }}:robot`]], ...letterButtons(src)];
// Вид письма → кнопки: robot (с 🚀) | manual (без 🚀) | wait (в очереди робота: только ⛔) | done (отправлено роботом)
// | none (закрыта — без кнопок). Telegram-нода не меняет число кнопок на ходу — по ноде на вид
const LETTER_VIEWS = [
  ['robot', (src) => robotLetterButtons(src)],
  ['manual', (src) => letterButtons(src)],
  ['wait', (src) => [[['⛔ Отменить', `=l:{{ ${src}.id }}:stop`]]]],
  [
    'done',
    (src) => [
      [
        ['🔗 Вакансия', { url: `={{ ${src}.url }}` }],
        ['📋 К вакансиям', 'p:n'],
      ],
    ],
  ],
  ['none', () => null],
];
// Перерисовать письмо по $json.layout: Switch «View» → нода правки на каждый вид; вид '' или неизвестный — последний
// выход, ни к чему не подключён. Вход: { chatId, messageId, text, layout, id, url, apply_url }
function letterViewNodes(wf, [x, y]) {
  const names = LETTER_VIEWS.map(([layout]) => layout);
  return {
    nodes: [
      node(wf, 'View', 'switch', 3.4, [x, y], {
        mode: 'expression',
        numberOutputs: names.length + 1,
        output: `={{ ((i) => (i < 0 ? ${names.length} : i))(${JSON.stringify(names)}.indexOf($json.layout)) }}`,
        options: {},
      }),
      ...LETTER_VIEWS.map(([layout, rows], i) =>
        editMessage(
          `Letter: ${layout}`,
          [x + 220, y - 200 + i * 100],
          { chatId: '={{ $json.chatId }}', messageId: '={{ $json.messageId }}', text: '={{ $json.text }}', rows: rows('$json') },
          wf,
          { onError: 'continueRegularOutput' },
        ),
      ),
    ],
    links: names.map((layout, i) => ['View', `Letter: ${layout}`, i]),
  };
}

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
        hhRequest({ url: SEARCH_URL, query: [...SEARCH_QUERY, ['page', '0']] }),
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
      // С 07.10.2026 сбор запускают «часы» W8 Clock по расписанию из настроек бота (⚙️ → 🕐 Сбор) и кнопка
      // «🔄 Собрать сейчас» (W7). Они передают kind: schedule | catchup | bot
      node('W1', 'Called', 'executeWorkflowTrigger', 1.1, [0, -100], { inputSource: 'passthrough' }),
      node('W1', 'Manual', 'manualTrigger', 1, [0, 100], {}),
      // Журнал сборов (07.10.2026): другой сбор ещё идёт — запись running моложе 10 мин → этот пропускаем
      node(
        'W1',
        'Busy',
        'dataTable',
        1.1,
        [220, 0],
        {
          resource: 'row',
          operation: 'get',
          dataTableId: RUNS,
          matchType: 'allConditions',
          filters: { conditions: [{ keyName: 'status', keyValue: 'running' }] },
          returnAll: true,
        },
        { executeOnce: true, alwaysOutputData: true },
      ),
      code('W1', 'Start', 'n8n/w1-collector/start.js', [440, 0]),
      node('W1', 'Start run', 'dataTable', 1.1, [660, 0], {
        resource: 'row',
        operation: 'insert',
        dataTableId: RUNS,
        columns: AUTO_MAP,
        options: {},
      }),
      node(
        'W1',
        'Any row',
        'dataTable',
        1.1,
        [880, 0],
        { resource: 'row', operation: 'get', dataTableId: VACANCIES, returnAll: false, limit: 1 },
        { alwaysOutputData: true, executeOnce: true },
      ),
      settingsNode('W1', [770, 150]),
      code('W1', 'Plan', 'n8n/w1-collector/plan.js', [1100, 0]),
      node(
        'W1',
        'Search hh',
        'httpRequest',
        4.5,
        [1320, 0],
        hhRequest({
          url: SEARCH_URL,
          // Слова и период — из «Plan» (настройки бота)
          query: [
            ...SEARCH_QUERY.map(([key, value]) => [
              key,
              { text: '={{ $json.text }}', search_period: '={{ $json.period }}' }[key] ?? value,
            ]),
            ['page', '={{ $json.page }}'],
          ],
          batching: true,
        }),
      ),
      code('W1', 'Parse search', 'n8n/w1-collector/parse-search.js', [1540, 0]),
      node('W1', 'OK?', 'if', 2.3, [1760, 0], ifTrue('W1', '={{ $json.ok }}')),
      // Сигнал стражу healthchecks.io: поиск прошёл. Нет сигнала дольше нормы — страж сам пишет в Telegram
      node('W1', 'HC ping?', 'if', 2.3, [1980, -300], ifTrue('W1', '={{ Boolean($env.HC_PING_URL) }}')),
      node(
        'W1',
        'HC ping',
        'httpRequest',
        4.5,
        [2200, -300],
        { method: 'GET', url: '={{ $env.HC_PING_URL }}', options: { timeout: 10000 } },
        { onError: 'continueRegularOutput' },
      ),
      node('W1', 'Split vacancies', 'splitOut', 1, [1980, -100], {
        fieldToSplitOut: 'vacancies',
        include: 'noOtherFields',
        options: {},
      }),
      node('W1', 'Is new', 'dataTable', 1.1, [2200, -100], {
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
        [2420, -100],
        { resource: 'row', operation: 'get', dataTableId: BLACKLIST, returnAll: true },
        { executeOnce: true, alwaysOutputData: true },
      ),
      code('W1', 'Filter search', 'n8n/w1-collector/filter-search.js', [2640, -100]),
      node('W1', 'Insert', 'dataTable', 1.1, [2860, -100], {
        resource: 'row',
        operation: 'insert',
        dataTableId: VACANCIES,
        columns: AUTO_MAP,
        options: {},
      }),
      node('W1', 'Is candidate', 'if', 2.3, [3080, -100], ifTrue('W1', "={{ $json.status === 'new' }}")),
      node(
        'W1',
        'Vacancy page',
        'httpRequest',
        4.5,
        [3300, -200],
        hhRequest({
          url: '={{ $json.url }}',
          headers: [...BROWSER_HEADERS, ['Referer', 'https://hh.ru/search/vacancy']],
          batching: true,
        }),
      ),
      code('W1', 'Parse vacancy', 'n8n/w1-collector/parse-vacancy.js', [3520, -200]),
      node('W1', 'Update', 'dataTable', 1.1, [3740, -200], {
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
      code('W1', 'Score job', 'n8n/w1-collector/score-job.js', [1980, 0]),
      // Итог сбора — в журнал. Выше «Score»: n8n (execution order v1) запишет его до вызова W2
      node('W1', 'Finish run', 'dataTable', 1.1, [2200, 0], {
        resource: 'row',
        operation: 'update',
        dataTableId: RUNS,
        ...byId('={{ $json.runId }}'),
        columns: setColumns({
          status: 'ok',
          finished_at: '={{ new Date().toISOString() }}',
          found: '={{ $json.run.found }}',
          uniq: '={{ $json.run.uniq }}',
          fresh: '={{ $json.run.fresh }}',
          rejected: '={{ $json.run.rejected }}',
          scoring: '={{ $json.run.scoring }}',
          pages: '={{ $json.run.pages }}',
        }),
        options: {},
      }),
      ...W1_RECOVERY.nodes,
      runWorkflow('W1', 'Score', [2200, 150], IDS.score),
      node('W1', 'To file', 'convertToFile', 1.1, [1980, 300], {
        operation: 'toText',
        sourceProperty: 'html',
        binaryPropertyName: 'data',
        options: { fileName: 'hh-fail.html' },
      }),
      node('W1', 'Save fixture', 'readWriteFile', 1.1, [2200, 300], {
        operation: 'write',
        fileName: "=/home/node/.n8n-files/fixtures/hh-fail-{{ $now.toFormat('yyyyLLdd-HHmmss') }}.html",
        dataPropertyName: 'data',
        options: {},
      }),
      // Поломка — тоже в журнал (ошибка записи журнала не должна спрятать саму поломку)
      node(
        'W1',
        'Fail run',
        'dataTable',
        1.1,
        [2420, 300],
        {
          resource: 'row',
          operation: 'update',
          dataTableId: RUNS,
          ...byId("={{ $('Start run').first().json.id }}"),
          columns: setColumns({
            status: 'error',
            finished_at: '={{ new Date().toISOString() }}',
            error: "={{ $('Parse search').first().json.reason }}",
          }),
          options: {},
        },
        { onError: 'continueRegularOutput' },
      ),
      node('W1', 'Stop', 'stopAndError', 1, [2640, 300], {
        errorType: 'errorMessage',
        errorMessage: "={{ $('Parse search').first().json.reason }}",
      }),
    ],
    [
      ['Called', 'Busy'],
      ['Manual', 'Busy'],
      ['Busy', 'Start'],
      ['Start', 'Start run'],
      ['Start run', 'Settings'],
      ['Settings', 'Any row'],
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
      ['Score job', 'Finish run'],
      ...W1_RECOVERY.links,
      ['Score job', 'Score'],
      ['OK?', 'To file', 1],
      ['To file', 'Save fixture'],
      ['Save fixture', 'Fail run'],
      ['Fail run', 'Stop'],
    ],
    // Успешные запуски не храним (07.10.2026): каждый несёт страницу поиска hh (~1,7 МБ), а итог сбора лежит
    // в журнале runs. Ошибки сохраняются и идут в W4
    { timezone: 'Europe/Moscow', errorWorkflow: IDS.errors, saveDataSuccessExecution: 'none' },
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
      // Захват (07.10.2026): detailed → scoring одним UPDATE с условием — второй запуск W2 эти строки уже не возьмёт
      // (Update отдаёт только обновлённые строки). Карточка не ушла — «Release» вернёт строку в detailed
      node('W2', 'Claim', 'dataTable', 1.1, [440, 0], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        matchType: 'allConditions',
        filters: {
          conditions: [
            { keyName: 'id', keyValue: '={{ $json.id }}' },
            { keyName: 'status', keyValue: 'detailed' },
          ],
        },
        columns: setColumns({ status: 'scoring' }),
        options: {},
      }),
      node(
        'W2',
        'Resume',
        'readWriteFile',
        1.1,
        [660, 0],
        { operation: 'read', fileSelector: '/home/node/.n8n-files/docs/resume.md', options: {} },
        { executeOnce: true },
      ),
      node('W2', 'Resume text', 'extractFromFile', 1.1, [880, 0], {
        operation: 'text',
        binaryPropertyName: 'data',
        destinationKey: 'resume',
        options: {},
      }),
      code('W2', 'Build prompt', 'n8n/w2-score/build-prompt.js', [1100, 0]),
      node('W2', 'Claude?', 'if', 2.3, [1320, 0], ifTrue('W2', "={{ $json.provider === 'claude' }}")),
      node(
        'W2',
        'Claude',
        'httpRequest',
        4.5,
        [1540, -100],
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
        [1540, 100],
        llmRequest({
          url: '=https://generativelanguage.googleapis.com/v1beta/models/{{ $json.model }}:generateContent',
          credential: 'googlePalmApi',
          // Бесплатный Gemini: 10–15 запросов в минуту → не чаще одного в 7 с
          interval: 7000,
        }),
        { credentials: { googlePalmApi: { id: IDS.geminiCredential, name: 'Gemini' } }, onError: 'continueRegularOutput' },
      ),
      code('W2', 'Parse verdict', 'n8n/w2-score/parse-verdict.js', [1760, 0]),
      // Настройки бота: провайдер и правила (Build prompt), теневой режим (Format card, Quiet skips)
      settingsNode('W2', [550, 150]),
      code('W2', 'Format card', 'n8n/w2-score/format-card.js', [1980, -100]),
      telegram('W2', 'Send card', [2200, -100], {
        markup: {
          replyMarkup: 'inlineKeyboard',
          inlineKeyboard: keyboard([
            [
              ['✅ Откликнусь', '=v:{{ $json.id }}:apply'],
              ['🤔 Возможно', '=v:{{ $json.id }}:maybe'],
              ['❌ Мимо', '=v:{{ $json.id }}:skip'],
            ],
            // Откликался до бота: без письма, вне теневого режима. «🚫 В ЧС» — компания в чёрный список, вакансия — ❌
            [
              ['📨 Уже откликался', '=v:{{ $json.id }}:earlier'],
              ['🚫 В ЧС', '=v:{{ $json.id }}:ban'],
            ],
          ]),
        },
        fields: { disable_notification: '={{ $json.silent }}' },
        // Ошибка одной карточки не должна терять остальные: Card sent запишет только отправленные
        extra: { onError: 'continueRegularOutput' },
      }),
      code('W2', 'Card sent', 'n8n/w2-score/card-sent.js', [2420, -100]),
      node('W2', 'Save cards', 'dataTable', 1.1, [2640, -100], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: AUTO_MAP,
        options: {},
      }),
      // Сообщения после запуска: о сборе («🔎 Сбор» из W1), итог оценки, тревоги. Своя ветка от триггера ниже ветки
      // карточек: n8n (execution order v1) выполняет её последней, даже если «Pending» пуст и карточек не было
      // Теневой режим выключен: skip без карточки — строка сразу skipped (ветка ниже карточек)
      code('W2', 'Quiet skips', 'n8n/w2-score/quiet-skips.js', [1980, 150]),
      node('W2', 'Save quiet skips', 'dataTable', 1.1, [2200, 150], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: AUTO_MAP,
        options: {},
      }),
      code('W2', 'Summary', 'n8n/w2-score/summary.js', [1980, 300]),
      telegram('W2', 'Send summary', [2200, 300], {
        fields: { disable_notification: '={{ $json.silent }}' },
        markup: MENU_KEYBOARD,
      }),
      // Сообщение о сборе одно: прошлое удаляется (решение пользователя 07.10.2026)
      code('W2', 'Live report', 'n8n/w2-score/live-report.js', [2420, 300]),
      node(
        'W2',
        'Delete report',
        'telegram',
        1.2,
        [2640, 300],
        { resource: 'message', operation: 'deleteMessage', chatId: '={{ $env.TG_CHAT_ID }}', messageId: '={{ $json.messageId }}' },
        // Сообщение старше 48 ч Telegram не удалит — это не ошибка
        { credentials: TELEGRAM_CREDENTIAL, onError: 'continueRegularOutput' },
      ),
      // Успешный запуск закрывает тревоги W2 (самая нижняя ветка)
      ...W2_RECOVERY.nodes,
      // Захваченные строки без отправленной карточки → снова detailed
      code('W2', 'Release', 'n8n/w2-score/release.js', [1980, 700]),
      node(
        'W2',
        'Save release',
        'dataTable',
        1.1,
        [2200, 700],
        {
          resource: 'row',
          operation: 'update',
          dataTableId: VACANCIES,
          matchType: 'allConditions',
          filters: {
            conditions: [
              { keyName: 'id', keyValue: '={{ $json.id }}' },
              { keyName: 'status', keyValue: 'scoring' },
            ],
          },
          columns: setColumns({ status: 'detailed' }),
          options: {},
        },
        { onError: 'continueRegularOutput' },
      ),
      // Журнал сборов: число карточек этого сбора (ниже «Summary» — выполняется последней)
      code('W2', 'Run stats', 'n8n/w2-score/run-stats.js', [1980, 500]),
      node(
        'W2',
        'Save run stats',
        'dataTable',
        1.1,
        [2200, 500],
        {
          resource: 'row',
          operation: 'update',
          dataTableId: RUNS,
          ...byId('={{ $json.id }}'),
          columns: setColumns({ cards: '={{ $json.cards }}' }),
          options: {},
        },
        { onError: 'continueRegularOutput' },
      ),
    ],
    [
      ['Called by W1', 'Pending'],
      ['Manual', 'Pending'],
      ['Called by W1', 'Summary'],
      ['Manual', 'Summary'],
      ['Called by W1', 'Run stats'],
      ['Run stats', 'Save run stats'],
      ['Called by W1', 'Release'],
      ['Manual', 'Release'],
      ['Release', 'Save release'],
      ...W2_RECOVERY.links,
      ['Pending', 'Claim'],
      ['Claim', 'Settings'],
      ['Settings', 'Resume'],
      ['Resume', 'Resume text'],
      ['Resume text', 'Build prompt'],
      ['Build prompt', 'Claude?'],
      ['Claude?', 'Claude', 0],
      ['Claude?', 'Gemini', 1],
      ['Claude', 'Parse verdict'],
      ['Gemini', 'Parse verdict'],
      ['Parse verdict', 'Format card'],
      ['Parse verdict', 'Quiet skips'],
      ['Quiet skips', 'Save quiet skips'],
      ['Format card', 'Send card'],
      ['Send card', 'Card sent'],
      ['Card sent', 'Save cards'],
      ['Summary', 'Send summary'],
      ['Send summary', 'Live report'],
      ['Live report', 'Delete report'],
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
      // Меню бота (кнопки под полем ввода, команды, кнопки панели) — в W7 Bot menu
      node('W3', 'Panel?', 'if', 2.3, [440, -400], ifTrue('W3', "={{ $json.action === 'panel' }}")),
      runWorkflow('W3', 'Menu', [660, -500], IDS.menu),
      // Робот-отклик (этап 6): 🚀, ⛔, ▶️, /go, ответ на фото капчи — всё решает W9 Robot (он и отвечает на нажатие)
      node('W3', 'Robot?', 'if', 2.3, [440, -250], ifTrue('W3', "={{ $json.action === 'robot' }}")),
      runWorkflow('W3', 'Robot', [660, -300], IDS.robot),
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
      // Отсеянная фильтром без описания (08.10.2026): ✅ / 🤔 / 🤖 с панели — сначала страница с hh (письму и нейросети
      // нужно описание). Не открылась — решение всё равно принимается
      node('W3', 'Rescue page?', 'if', 2.3, [770, -300], ifTrue('W3',
        "={{ $json.status === 'rejected' && !$json.description && ['apply', 'maybe', 'score'].includes($('Route').first().json.choice) }}")),
      node(
        'W3',
        'Rescue page',
        'httpRequest',
        4.5,
        [880, -450],
        hhRequest({ url: '={{ $json.url }}', headers: [...BROWSER_HEADERS, ['Referer', 'https://hh.ru/search/vacancy']] }),
      ),
      code('W3', 'Rescue parse', 'n8n/w3-telegram/rescue-parse.js', [1100, -450]),
      node('W3', 'Save page', 'dataTable', 1.1, [1320, -450], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: setColumns({
          description: '={{ $json.description }}',
          key_skills: '={{ $json.key_skills }}',
          has_test: '={{ $json.has_test }}',
          contract: '={{ $json.contract }}',
          error: '={{ $json.error }}',
        }),
        options: {},
      }),
      code('W3', 'Apply choice', 'n8n/w3-telegram/apply-choice.js', [880, -100]),
      node('W3', 'Save choice', 'dataTable', 1.1, [1100, -100], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: setColumns({
          my_decision: '={{ $json.my_decision }}',
          status: '={{ $json.status }}',
          my_reason: '={{ $json.my_reason }}',
        }),
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
      // Отсеянная фильтром: карточки в ленте нет — отправить новую (на неё ответят «Почему?» и письмо)
      node('W3', 'New card?', 'if', 2.3, [1650, -300], ifTrue('W3', `={{ ${CHOICE}.new_card }}`)),
      telegram('W3', 'Card: new', [1760, -400], {
        text: `={{ ${CHOICE}.text }}`,
        fields: { disable_notification: true },
        markup: { replyMarkup: 'inlineKeyboard', inlineKeyboard: keyboard([[['↩️ Изменить', `=v:{{ ${CHOICE}.id }}:edit`]]]) },
      }),
      node('W3', 'Save card', 'dataTable', 1.1, [1870, -400], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId(`={{ ${CHOICE}.id }}`),
        columns: setColumns({ tg_message_id: '={{ $json.result.message_id }}', card_at: '={{ new Date().toISOString() }}' }),
        options: {},
      }),
      editCard('Card: decided', [1760, -200], [[['↩️ Изменить', `=v:{{ ${CHOICE}.id }}:edit`]]]),
      // keyboard = none (🤖 На оценку, закрыта на hh) — перерисовывать нечего
      node('W3', 'Choose?', 'if', 2.3, [1650, 0], ifTrue('W3', `={{ ${CHOICE}.keyboard === 'choose' }}`)),
      editCard('Card: choose', [1760, 0], [
        [
          ['✅ Откликнусь', `=v:{{ ${CHOICE}.id }}:apply`],
          ['🤔 Возможно', `=v:{{ ${CHOICE}.id }}:maybe`],
          ['❌ Мимо', `=v:{{ ${CHOICE}.id }}:skip`],
        ],
        [
          ['📨 Уже откликался', `=v:{{ ${CHOICE}.id }}:earlier`],
          ['🚫 В ЧС', `=v:{{ ${CHOICE}.id }}:ban`],
        ],
      ]),
      node('W3', 'Ask?', 'if', 2.3, [1980, -200], ifTrue('W3', `={{ Boolean(${CHOICE}.ask) }}`)),
      telegram('W3', 'Ask why', [2200, -200], {
        text: `={{ ${CHOICE}.ask }}`,
        // У отсеянной фильтром карточка только что отправлена («Card: new»)
        fields: {
          reply_to_message_id: `={{ ${CHOICE}.messageId || ($('Card: new').isExecuted ? $('Card: new').first().json.result.message_id : '') }}`,
        },
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
        columns: setColumns({
          status: '={{ $json.status }}',
          applied_at: '={{ $json.applied_at }}',
          apply_by: '={{ $json.apply_by }}',
        }),
        options: {},
      }),
      answerQuery('W3', 'Answer sent', [1760, 300], `={{ ${SENT}.queryId }}`, `={{ ${SENT}.toast }}`),
      // Вакансия в очереди робота (этап 6) — только тост, кнопки письма и карточки не трогаем
      node('W3', 'Busy sent?', 'if', 2.3, [1870, 300], ifTrue('W3', `={{ ${SENT}.busy }}`)),
      node('W3', 'Sent?', 'if', 2.3, [1980, 300], ifTrue('W3', `={{ ${SENT}.sent }}`)),
      // «📨 Отправил»: у письма — только «↩️ Отменить», у карточки кнопок нет
      editW3('Letter: sent', [2200, 250], {
        chatId: `={{ ${SENT}.chatId }}`,
        messageId: `={{ ${SENT}.letterMessageId }}`,
        text: `={{ ${SENT}.letterText }}`,
        // «📋 К вакансиям» — новая панель со списком там, где был (p:n → W7)
        rows: [[['↩️ Отменить', `=l:{{ ${SENT}.id }}:unsent`]], [['📋 К вакансиям', 'p:n']]],
      }),
      editW3('Card: sent', [2420, 250], {
        chatId: `={{ ${SENT}.chatId }}`,
        messageId: `={{ ${SENT}.cardId }}`,
        text: `={{ ${SENT}.cardText }}`,
        rows: null,
      }),
      // «↩️ Отменить»: письму возвращаются все кнопки, карточке — «↩️ Изменить»
      editW3('Letter: restore', [2200, 400], {
        chatId: `={{ ${SENT}.chatId }}`,
        messageId: `={{ ${SENT}.letterMessageId }}`,
        text: `={{ ${SENT}.letterText }}`,
        rows: letterButtons(SENT),
      }),
      // Вакансия подходит роботу (этап 6) — письму возвращается и 🚀; выключенного робота W9 поймает при нажатии
      node('W3', 'Restore robot?', 'if', 2.3, [2090, 450], ifTrue('W3', `={{ ${SENT}.robot }}`)),
      editW3('Letter: restore robot', [2200, 550], {
        chatId: `={{ ${SENT}.chatId }}`,
        messageId: `={{ ${SENT}.letterMessageId }}`,
        text: `={{ ${SENT}.letterText }}`,
        rows: robotLetterButtons(SENT),
      }),
      editW3('Card: restore', [2420, 400], {
        chatId: `={{ ${SENT}.chatId }}`,
        messageId: `={{ ${SENT}.cardId }}`,
        text: `={{ ${SENT}.cardText }}`,
        rows: [[['↩️ Изменить', `=v:{{ ${SENT}.id }}:edit`]]],
      }),
      // Решение на карточке в ленте, отклик отправлен или отменён — обновить панель меню,
      // если на ней открыта эта вакансия (W7)
      code('W3', 'Sync job', 'n8n/w3-telegram/sync-job.js', [2640, 325]),
      runWorkflow('W3', 'Panel sync', [2860, 325], IDS.menu),
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
      // Ответ на письмо, пока робот его отправляет (этап 6), — правку не применяем
      node('W3', 'Busy?', 'if', 2.3, [1210, 450], ifTrue('W3', "={{ $json.kind === 'busy' }}")),
      telegram('W3', 'Busy reply', [1320, 350], {
        text: '🚀 Робот уже откликается с этим письмом — правку не применяю. Сначала ⛔ под письмом',
        fields: { reply_to_message_id: "={{ $('Route').first().json.messageId }}", disable_notification: true },
        markup: MENU_KEYBOARD,
      }),
      node('W3', 'Revise?', 'if', 2.3, [1320, 500], ifTrue('W3', "={{ $json.kind === 'revise' }}")),
      node('W3', 'Save reason', 'dataTable', 1.1, [1540, 600], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: setColumns({ my_reason: '={{ $json.text }}' }),
        options: {},
      }),
      // Ответ на «Почему?» (force reply спрятал кнопки меню) — подтверждение возвращает их
      telegram('W3', 'Confirm', [1760, 600], {
        text: '✍️ Записал причину',
        fields: { reply_to_message_id: "={{ $('Route').first().json.messageId }}", disable_notification: true },
        markup: MENU_KEYBOARD,
      }),
      // Решение принято в карточке на панели меню: после правки исходной карточки — перерисовать панель (W7).
      // Ветка ниже «Decided?»: n8n (execution order v1) выполняет её последней
      node('W3', 'From panel?', 'if', 2.3, [1540, 150], ifTrue('W3', `={{ Boolean(${CHOICE}.panel) }}`)),
      // «🚫 В ЧС» (07.10.2026): компания — в чёрный список (название как в карточке; id на hh — в комментарии)
      node('W3', 'Ban?', 'if', 2.3, [1540, 800], ifTrue('W3', `={{ Boolean(${CHOICE}.ban) }}`)),
      node(
        'W3',
        'Ban company',
        'dataTable',
        1.1,
        [1760, 800],
        {
          resource: 'row',
          operation: 'insert',
          dataTableId: BLACKLIST,
          columns: setColumns({
            company: `={{ ${CHOICE}.ban.company }}`,
            comment: `={{ 'кнопка «🚫 В ЧС» ' + $now.toFormat('dd.MM') + (${CHOICE}.ban.company_id ? ' · hh ' + ${CHOICE}.ban.company_id : '') + ' · ' + ${CHOICE}.ban.title }}`,
          }),
          options: {},
        },
        { onError: 'continueRegularOutput' },
      ),
      // «🤖 На оценку» у отсеянной (08.10.2026): оценить сразу, не дожидаясь сбора. Ниже панели — n8n (execution order v1)
      // запустит W2 последним
      node('W3', 'Score?', 'if', 2.3, [1540, 950], ifTrue('W3', `={{ ${CHOICE}.score }}`)),
      runWorkflow('W3', 'Score now', [1760, 950], IDS.score),
      code('W3', 'Panel job', 'n8n/w3-telegram/panel-job.js', [1760, 150]),
      runWorkflow('W3', 'Panel refresh', [1980, 150], IDS.menu),
      // Письмо: одна нода на три ветки (✅, «🔄 Переписать», ответ на письмо) → W5 Letter
      code('W3', 'Letter job', 'n8n/w3-telegram/letter-job.js', [2200, 100]),
      // Письмо уже пишется (07.10.2026): второе нажатие ✅ или «🔄» не запускает второй W5. Блокировка — letter_lock,
      // захват — UPDATE «где пусто». Зависшая блокировка (W5 упал, не дойдя до «Unlock») старше 3 мин снимается
      node(
        'W3',
        'Unlock stale',
        'dataTable',
        1.1,
        [2420, 100],
        {
          resource: 'row',
          operation: 'update',
          dataTableId: VACANCIES,
          matchType: 'allConditions',
          filters: {
            conditions: [
              { keyName: 'id', keyValue: '={{ $json.id }}' },
              {
                keyName: 'letter_lock',
                condition: 'lt',
                keyValue: '={{ new Date(Date.now() - 3 * 60 * 1000).toISOString() }}',
              },
            ],
          },
          columns: setColumns({ letter_lock: '' }),
          options: {},
        },
        { alwaysOutputData: true },
      ),
      node('W3', 'Letter lock', 'dataTable', 1.1, [2640, 100], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        matchType: 'allConditions',
        filters: {
          conditions: [
            { keyName: 'id', keyValue: "={{ $('Letter job').first().json.id }}" },
            { keyName: 'letter_lock', condition: 'isEmpty' },
          ],
        },
        columns: setColumns({ letter_lock: '={{ new Date().toISOString() }}' }),
        options: {},
      }),
      code('W3', 'Locked job', 'n8n/w3-telegram/locked-job.js', [2860, 100]),
      runWorkflow('W3', 'Write letter', [3080, 100], IDS.letter),
    ],
    [
      ['Telegram Trigger', 'Route'],
      ['Route', 'Panel?'],
      ['Panel?', 'Menu', 0],
      ['Panel?', 'Robot?', 1],
      ['Robot?', 'Robot', 0],
      ['Robot?', 'Button?', 1],
      ['Button?', 'Vacancy', 0],
      ['Vacancy', 'Rescue page?'],
      ['Rescue page?', 'Rescue page', 0],
      ['Rescue page', 'Rescue parse'],
      ['Rescue parse', 'Save page'],
      ['Save page', 'Apply choice'],
      ['Rescue page?', 'Apply choice', 1],
      ['Apply choice', 'Save choice'],
      ['Save choice', 'Answer'],
      ['Answer', 'Decided?'],
      ['Answer', 'From panel?'],
      ['Answer', 'Ban?'],
      ['Answer', 'Score?'],
      ['Score?', 'Score now', 0],
      ['Ban?', 'Ban company', 0],
      ['From panel?', 'Panel job', 0],
      ['From panel?', 'Sync job', 1],
      ['Panel job', 'Panel refresh'],
      ['Decided?', 'New card?', 0],
      ['New card?', 'Card: new', 0],
      ['Card: new', 'Save card'],
      ['Save card', 'Ask?'],
      ['Save card', 'Letter?'],
      ['New card?', 'Card: decided', 1],
      ['Decided?', 'Choose?', 1],
      ['Choose?', 'Card: choose', 0],
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
      ['Answer sent', 'Busy sent?'],
      ['Busy sent?', 'Sent?', 1],
      ['Sent?', 'Letter: sent', 0],
      ['Letter: sent', 'Card: sent'],
      ['Sent?', 'Restore robot?', 1],
      ['Restore robot?', 'Letter: restore robot', 0],
      ['Restore robot?', 'Letter: restore', 1],
      ['Letter: restore', 'Card: restore'],
      ['Letter: restore robot', 'Card: restore'],
      ['Card: sent', 'Sync job'],
      ['Card: restore', 'Sync job'],
      ['Sync job', 'Panel sync'],
      ['Letter button?', 'Reply row', 1],
      ['Reply row', 'Reply kind'],
      ['Reply kind', 'Busy?'],
      ['Busy?', 'Busy reply', 0],
      ['Busy?', 'Revise?', 1],
      ['Revise?', 'Letter job', 0],
      ['Revise?', 'Save reason', 1],
      ['Save reason', 'Confirm'],
      ['Letter job', 'Unlock stale'],
      ['Unlock stale', 'Letter lock'],
      ['Letter lock', 'Locked job'],
      ['Locked job', 'Write letter'],
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
      // Провайдер нейросети — из настроек бота (⚙️ → 🤖 Нейросеть)
      settingsNode('W5', [770, 150]),
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
      // Робот включён и вакансия ему подходит (этап 6) — письмо сразу с [🚀 Откликнуться роботом]
      node('W5', 'Robot letter?', 'if', 2.3, [2750, 0], ifTrue('W5', '={{ $json.robot }}')),
      telegram('W5', 'Send letter', [2860, 100], {
        markup: {
          replyMarkup: 'inlineKeyboard',
          inlineKeyboard: keyboard(letterButtons('$json')),
        },
        fields: { reply_to_message_id: '={{ $json.replyTo }}' },
        extra: { onError: 'continueRegularOutput' },
      }),
      telegram('W5', 'Send letter: robot', [2860, -100], {
        markup: {
          replyMarkup: 'inlineKeyboard',
          inlineKeyboard: keyboard(robotLetterButtons('$json')),
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
      // Новое письмо отправлено и записано — прошлое письмо (и ответ с пожеланием) удалить: в ленте только актуальное
      code('W5', 'Old letters', 'n8n/w5-letter/old-letters.js', [3520, 0]),
      node(
        'W5',
        'Delete old letter',
        'telegram',
        1.2,
        [3740, 0],
        { resource: 'message', operation: 'deleteMessage', chatId: '={{ $env.TG_CHAT_ID }}', messageId: '={{ $json.messageId }}' },
        { credentials: TELEGRAM_CREDENTIAL, onError: 'continueRegularOutput' },
      ),
      // Письмо готово или не получилось — снять блокировку W3 «Letter lock». Ветка ниже — выполняется последней
      node(
        'W5',
        'Unlock',
        'dataTable',
        1.1,
        [440, 600],
        {
          resource: 'row',
          operation: 'update',
          dataTableId: VACANCIES,
          ...byId('={{ $json.id }}'),
          columns: setColumns({ letter_lock: '' }),
          options: {},
        },
        { onError: 'continueRegularOutput' },
      ),
    ],
    [
      ['Called by W3', 'Jobs'],
      ['Called by W3', 'Unlock'],
      ['Manual', 'Approved'],
      ['Approved', 'Jobs'],
      ['Jobs', 'Vacancy'],
      ['Vacancy', 'Settings'],
      ['Settings', 'Resume'],
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
      ['Format letter', 'Robot letter?'],
      ['Robot letter?', 'Send letter: robot', 0],
      ['Robot letter?', 'Send letter', 1],
      ['Send letter', 'Letter sent'],
      ['Send letter: robot', 'Letter sent'],
      ['Letter sent', 'Save letter'],
      ['Save letter', 'Old letters'],
      ['Old letters', 'Delete old letter'],
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
      // Расписание и пауза — из настроек бота: сколько сборов положено
      settingsNode('W6', [660, 250]),
      // Журнал сборов за последние сутки с запасом — «сборов N из M»
      node(
        'W6',
        'Runs',
        'dataTable',
        1.1,
        [880, 250],
        {
          resource: 'row',
          operation: 'get',
          dataTableId: RUNS,
          returnAll: false,
          limit: 200,
          orderBy: true,
          orderByColumn: 'createdAt',
          orderByDirection: 'DESC',
        },
        { executeOnce: true, alwaysOutputData: true },
      ),
      // Запуски n8n за сутки — публичный API (ключ в credential «n8n API»): ошибки всех workflow
      node(
        'W6',
        'Executions',
        'httpRequest',
        4.5,
        [1100, 250],
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
      // Робот-отклик (этап 6): жив ли, вошёл ли в hh, не ждёт ли человека — для сводки, если он включён
      applierNode('W6', 'Robot health', [1210, 400], { path: '/health', timeout: 5000 }, { executeOnce: true }),
      // Туннель ngrok жив, если снаружи отвечает 403: политика не пускает адреса не из Telegram
      node(
        'W6',
        'Tunnel',
        'httpRequest',
        4.5,
        [1320, 250],
        {
          method: 'GET',
          url: '=https://{{ $env.NGROK_DOMAIN }}/',
          options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } }, timeout: 15000 },
        },
        { onError: 'continueRegularOutput' },
      ),
      code('W6', 'Summary', 'n8n/w6-summary/summary.js', [1540, 250]),
      telegram('W6', 'Send summary', [1760, 250], {
        fields: { disable_notification: '={{ $json.silent }}' },
        markup: MENU_KEYBOARD,
      }),
      // Чистка — ниже сводки, выполняется последней: описания отработанных вакансий старше 30 дней
      // и журнал сборов старше 90 дней
      code('W6', 'Cleanup', 'n8n/w6-summary/cleanup.js', [660, 600]),
      node('W6', 'Save stripped', 'dataTable', 1.1, [880, 600], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        ...byId('={{ $json.id }}'),
        columns: setColumns({ description: '', snippet: '' }),
        options: {},
      }),
      node(
        'W6',
        'Delete old alerts',
        'dataTable',
        1.1,
        [660, 1200],
        {
          resource: 'row',
          operation: 'deleteRows',
          dataTableId: ALERTS,
          matchType: 'allConditions',
          filters: {
            conditions: [
              {
                keyName: 'last_at',
                condition: 'lt',
                keyValue: '={{ new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() }}',
              },
            ],
          },
          options: {},
        },
        { executeOnce: true, onError: 'continueRegularOutput' },
      ),
      code('W6', 'Unstick', 'n8n/w6-summary/unstick.js', [660, 1000]),
      node('W6', 'Save unstuck', 'dataTable', 1.1, [880, 1000], {
        resource: 'row',
        operation: 'update',
        dataTableId: VACANCIES,
        matchType: 'allConditions',
        filters: {
          conditions: [
            { keyName: 'id', keyValue: '={{ $json.id }}' },
            { keyName: 'status', keyValue: 'scoring' },
          ],
        },
        columns: setColumns({ status: 'detailed' }),
        options: {},
      }),
      node(
        'W6',
        'Delete old runs',
        'dataTable',
        1.1,
        [660, 800],
        {
          resource: 'row',
          operation: 'deleteRows',
          dataTableId: RUNS,
          matchType: 'allConditions',
          filters: {
            conditions: [
              {
                keyName: 'started_at',
                condition: 'lt',
                keyValue: '={{ new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString() }}',
              },
            ],
          },
          options: {},
        },
        { executeOnce: true, onError: 'continueRegularOutput' },
      ),
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
      ['Plan', 'Settings'],
      ['Settings', 'Runs'],
      ['Runs', 'Executions'],
      ['Executions', 'Robot health'],
      ['Robot health', 'Tunnel'],
      ['Tunnel', 'Summary'],
      ['Summary', 'Send summary'],
      ['Plan', 'Cleanup'],
      ['Cleanup', 'Save stripped'],
      ['Plan', 'Delete old runs'],
      ['Plan', 'Unstick'],
      ['Plan', 'Delete old alerts'],
      ['Unstick', 'Save unstuck'],
    ],
    { timezone: 'Europe/Moscow', errorWorkflow: IDS.errors },
  ),

  'w7-menu': workflow(
    IDS.menu,
    'W7 Bot menu',
    [
      // Вызов из W3: кнопки меню, команды и кнопки панели («Route») или перерисовка после решения («Panel job»)
      node('W7', 'Called by W3', 'executeWorkflowTrigger', 1.1, [0, -100], { inputSource: 'passthrough' }),
      // Ручной запуск — приветствие с кнопками меню под полем ввода (один раз после деплоя)
      node('W7', 'Manual', 'manualTrigger', 1, [0, 100], {}),
      code('W7', 'Manual job', 'n8n/w7-menu/manual-job.js', [220, 100]),
      code('W7', 'Job', 'n8n/w7-menu/job.js', [440, 0]),
      node('W7', 'Answer?', 'if', 2.3, [660, 0], ifTrue('W7', '={{ Boolean($json.queryId) }}')),
      // Убрать «часики» на кнопке. Запрос старше ~15 мин Telegram не примет — это не ошибка
      answerQuery('W7', 'Answer query', [880, -100], "={{ $('Job').first().json.queryId }}", '', {
        onError: 'continueRegularOutput',
      }),
      // p:x — неактивная кнопка: только убрать «часики»
      node('W7', 'Work?', 'if', 2.3, [1100, 0], ifTrue('W7', "={{ $('Job').first().json.view !== 'noop' }}")),
      settingsNode('W7', [1320, 0]),
      // ⚙️ Настройки (07.10.2026). Ветки выше «Rows» выполняются раньше: «Render» покажет новое значение
      code('W7', 'Setting change', 'n8n/w7-menu/setting-change.js', [1540, -1300]),
      node('W7', 'Save setting', 'dataTable', 1.1, [1760, -1300], {
        resource: 'row',
        operation: 'upsert',
        dataTableId: SETTINGS_TABLE,
        matchType: 'allConditions',
        filters: { conditions: [{ keyName: 'name', keyValue: '={{ $json.name }}' }] },
        columns: setColumns({ name: '={{ $json.name }}', value_json: '={{ $json.value_json }}' }),
        options: {},
      }),
      // Расписание поменялось — страж healthchecks.io получает новый OnCalendar (или паузу) через свой API
      code('W7', 'HC plan', 'n8n/w7-menu/hc-plan.js', [1980, -1300]),
      node(
        'W7',
        'HC sync',
        'httpRequest',
        4.5,
        [2200, -1300],
        {
          method: 'POST',
          url: '={{ $json.url }}',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          sendBody: true,
          contentType: 'json',
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json.body) }}',
          options: { timeout: 15000 },
        },
        {
          credentials: { httpHeaderAuth: { id: IDS.hcCredential, name: 'healthchecks API' } },
          onError: 'continueRegularOutput',
        },
      ),
      // ⚙️ → 🚀 Робот поменяли — W9: выключили → очередь назад в ✅, иначе обработать очередь
      code('W7', 'Robot kick', 'n8n/w7-menu/robot-kick.js', [1980, -1450]),
      runWorkflow('W7', 'Run W9', [2200, -1450], IDS.robot),
      code('W7', 'Collect now', 'n8n/w7-menu/collect-now.js', [1540, -1100]),
      runWorkflow('W7', 'Run W1', [1760, -1100], IDS.collector),
      // Чёрный список — для ⚙️ → 🧹 Фильтр; «🗑 Убрать» удаляет строку до «Render»
      node(
        'W7',
        'Blacklist',
        'dataTable',
        1.1,
        [1430, 150],
        { resource: 'row', operation: 'get', dataTableId: BLACKLIST, returnAll: true },
        { executeOnce: true, alwaysOutputData: true },
      ),
      code('W7', 'Unban', 'n8n/w7-menu/unban.js', [1540, -900]),
      node(
        'W7',
        'Delete ban',
        'dataTable',
        1.1,
        [1760, -900],
        { resource: 'row', operation: 'deleteRows', dataTableId: BLACKLIST, ...byId('={{ $json.id }}'), options: {} },
        { onError: 'continueRegularOutput' },
      ),
      node(
        'W7',
        'Rows',
        'dataTable',
        1.1,
        [1540, 0],
        { resource: 'row', operation: 'get', dataTableId: VACANCIES, returnAll: true },
        { executeOnce: true, alwaysOutputData: true },
      ),
      // Журнал сборов — для статистики: последние 100 записей (сутки — это 29 сборов)
      node(
        'W7',
        'Runs',
        'dataTable',
        1.1,
        [1760, 0],
        {
          resource: 'row',
          operation: 'get',
          dataTableId: RUNS,
          returnAll: false,
          limit: 100,
          orderBy: true,
          orderByColumn: 'createdAt',
          orderByDirection: 'DESC',
        },
        { executeOnce: true, alwaysOutputData: true },
      ),
      // Состояние робота — только для ⚙️ (корень и 🚀 Робот): остальным панелям лишний запрос не нужен
      node('W7', 'Robot health?', 'if', 2.3, [1870, 150], ifTrue('W7',
        "={{ $('Job').first().json.view === 'settings' && ['root', 'apply', undefined, ''].includes($('Job').first().json.section) }}")),
      applierNode('W7', 'Robot health', [1980, 250], { path: '/health', timeout: 3000 }, { executeOnce: true }),
      code('W7', 'Render', 'n8n/w7-menu/render.js', [1980, 0]),
      // Выход = $json.route (render.js): раскладка × новое сообщение (чётный) / правка панели (нечётный), 10 — приветствие
      node('W7', 'Layout', 'switch', 3.4, [1980, -300], {
        mode: 'expression',
        numberOutputs: PANEL_LAYOUTS.length * 2 + 2,
        output: '={{ $json.route }}',
        options: {},
      }),
      ...PANEL_LAYOUTS.flatMap(([layout, rows], i) => [
        // Панель без звука: её вызывает сам пользователь
        telegram('W7', `New: ${layout}`, [2200, -900 + i * 300], {
          fields: { disable_notification: true },
          markup: { replyMarkup: 'inlineKeyboard', inlineKeyboard: keyboard(rows) },
        }),
        // Правка панели: «message is not modified» (нажали то же самое) — не ошибка
        editMessage(
          `Edit: ${layout}`,
          [2200, -750 + i * 300],
          { chatId: '={{ $json.chatId }}', messageId: '={{ $json.messageId }}', text: '={{ $json.text }}', rows },
          'W7',
          { onError: 'continueRegularOutput' },
        ),
      ]),
      telegram('W7', 'New: start', [2200, -900 + PANEL_LAYOUTS.length * 300], {
        fields: { disable_notification: true },
        markup: MENU_KEYBOARD,
      }),
      // «✏️» в ⚙️: вопрос со списком — ответ сообщением (ForceReply); панель не трогаем, в Remember не идёт
      telegram('W7', 'New: prompt', [2200, -600 + PANEL_LAYOUTS.length * 300], {
        fields: { disable_notification: true },
        markup: { replyMarkup: 'forceReply', forceReply: { force_reply: true } },
      }),
      code('W7', 'Remember', 'n8n/w7-menu/remember.js', [2420, -300]),
      // Ветка ниже «Layout»: старая панель и нажатие пользователя удаляются после отправки новой
      code('W7', 'Delete ids', 'n8n/w7-menu/delete-ids.js', [1980, 900]),
      node(
        'W7',
        'Delete old',
        'telegram',
        1.2,
        [2200, 900],
        { resource: 'message', operation: 'deleteMessage', chatId: '={{ $json.chatId }}', messageId: '={{ $json.messageId }}' },
        { credentials: TELEGRAM_CREDENTIAL, onError: 'continueRegularOutput' },
      ),
    ],
    [
      ['Called by W3', 'Job'],
      ['Manual', 'Manual job'],
      ['Manual job', 'Job'],
      ['Job', 'Answer?'],
      ['Answer?', 'Answer query', 0],
      ['Answer query', 'Work?'],
      ['Answer?', 'Work?', 1],
      ['Work?', 'Settings', 0],
      ['Settings', 'Blacklist'],
      ['Blacklist', 'Setting change'],
      ['Setting change', 'Save setting'],
      ['Save setting', 'Robot kick'],
      ['Robot kick', 'Run W9'],
      ['Save setting', 'HC plan'],
      ['HC plan', 'HC sync'],
      ['Blacklist', 'Collect now'],
      ['Collect now', 'Run W1'],
      ['Blacklist', 'Unban'],
      ['Unban', 'Delete ban'],
      ['Blacklist', 'Rows'],
      ['Rows', 'Runs'],
      ['Runs', 'Robot health?'],
      ['Robot health?', 'Robot health', 0],
      ['Robot health', 'Render'],
      ['Robot health?', 'Render', 1],
      ['Render', 'Layout'],
      ...PANEL_LAYOUTS.flatMap(([layout], i) => [
        ['Layout', `New: ${layout}`, i * 2],
        ['Layout', `Edit: ${layout}`, i * 2 + 1],
        [`New: ${layout}`, 'Remember'],
        [`Edit: ${layout}`, 'Remember'],
      ]),
      ['Layout', 'New: start', PANEL_LAYOUTS.length * 2],
      ['Layout', 'New: prompt', PANEL_LAYOUTS.length * 2 + 1],
      ['New: start', 'Remember'],
      ['Render', 'Delete ids'],
      ['Delete ids', 'Delete old'],
    ],
    // Успешные запуски не храним: каждый тянет всю таблицу вакансий. Ошибки сохраняются (и идут в W4)
    { errorWorkflow: IDS.errors, saveDataSuccessExecution: 'none' },
  ),

  'w8-clock': workflow(
    IDS.clock,
    'W8 Clock',
    [
      // «Часы» (07.10.2026): тикают каждые 15 мин, а когда собирать — решают настройки бота (⚙️ → 🕐 Сбор).
      // Mac спал — после пробуждения один догоняющий тик (coalesce), и «Due» запустит один догоняющий сбор
      node('W8', 'Schedule', 'scheduleTrigger', 1.4, [0, -100], {
        rule: { interval: [{ field: 'cronExpression', expression: '*/15 * * * *' }] },
        misfirePolicy: 'coalesce',
      }),
      node('W8', 'Manual', 'manualTrigger', 1, [0, 100], {}),
      settingsNode('W8', [220, 0]),
      code('W8', 'Due', 'n8n/w8-clock/due.js', [440, 0]),
      runWorkflow('W8', 'Collect', [660, 0], IDS.collector),
    ],
    [
      ['Schedule', 'Settings'],
      ['Manual', 'Settings'],
      ['Settings', 'Due'],
      ['Due', 'Collect'],
    ],
    // Тики без сбора не храним: 96 запусков в сутки. Static data (dispatchedAt) сохраняется и так
    { timezone: 'Europe/Moscow', errorWorkflow: IDS.errors, saveDataSuccessExecution: 'none' },
  ),

  // Робот-отклик (этап 6, docs/stages/stage-6.md): очередь 🚀 в колонке apply_state, отклик — сервис applier
  'w9-robot': (() => {
    const view = letterViewNodes('W9', [2420, -1300]);
    const GATE = "$('Gate').first().json";
    const NOTICE = "$('Notice item').first().json.notice";
    const RESULT = "$('Result').first().json";
    const JOB = "$('Job').first().json";
    return workflow(
      IDS.robot,
      'W9 Robot',
      [
        // Вызов: W3 (🚀 ⛔ ▶️ /go, ответ на капчу), W7 (⚙️ → 🚀 Робот), W10 (6.2), сам W9 (очередь не пуста)
        node('W9', 'Called', 'executeWorkflowTrigger', 1.1, [0, -200], { inputSource: 'passthrough' }),
        // Раз в минуту — страховка: после сна Mac, капчи, занятости робота, на следующий «день»
        node('W9', 'Schedule', 'scheduleTrigger', 1.4, [0, 0], {
          rule: { interval: [{ field: 'cronExpression', expression: '* * * * *' }] },
          misfirePolicy: 'coalesce',
        }),
        node('W9', 'Manual', 'manualTrigger', 1, [0, 200], {}),
        code('W9', 'Job', 'n8n/w9-robot/job.js', [220, 0]),
        settingsNode('W9', [440, 0]),
        // 0 — 🚀 / ⛔, 1 — очередь, 2 — ▶️ / /go, 3 — ответ на капчу, 4 — робот выключен.
        // Один раз: «Settings» отдаёт по item на настройку — иначе каждая ветка шла бы столько же раз
        node(
          'W9',
          'Op',
          'switch',
          3.4,
          [660, 0],
          {
            mode: 'expression',
            numberOutputs: 5,
            output: `={{ ({ enqueue: 0, stop: 0, tick: 1, resume: 2, captcha: 3, dequeue: 4 })[${JOB}.op] ?? 1 }}`,
            options: {},
          },
          { executeOnce: true },
        ),

        // ---- 🚀 / ⛔: запись с условием (двойное нажатие и гонка с роботом ничего не ломают)
        node(
          'W9',
          'Row',
          'dataTable',
          1.1,
          [880, -1100],
          { resource: 'row', operation: 'get', dataTableId: VACANCIES, ...byId(`={{ ${JOB}.id }}`), returnAll: false, limit: 1 },
          { alwaysOutputData: true },
        ),
        code('W9', 'Plan', 'n8n/w9-robot/plan.js', [1100, -1100]),
        node('W9', 'Save?', 'switch', 3.4, [1320, -1100], {
          mode: 'expression',
          numberOutputs: 3,
          output: '={{ ({ enqueue: 0, unqueue: 1 })[$json.save] ?? 2 }}',
          options: {},
        }),
        node(
          'W9',
          'Enqueue',
          'dataTable',
          1.1,
          [1540, -1200],
          {
            resource: 'row',
            operation: 'update',
            dataTableId: VACANCIES,
            matchType: 'allConditions',
            filters: {
              conditions: [
                { keyName: 'id', keyValue: '={{ $json.id }}' },
                { keyName: 'status', keyValue: 'approved' },
                { keyName: 'apply_state', condition: 'isEmpty' },
              ],
            },
            columns: setColumns({
              apply_state: 'queued',
              apply_queued_at: '={{ new Date().toISOString() }}',
              apply_result: '',
              apply_note: '',
            }),
            options: {},
          },
          { alwaysOutputData: true },
        ),
        node(
          'W9',
          'Unqueue',
          'dataTable',
          1.1,
          [1540, -1050],
          {
            resource: 'row',
            operation: 'update',
            dataTableId: VACANCIES,
            matchType: 'allConditions',
            filters: {
              conditions: [
                { keyName: 'id', keyValue: '={{ $json.id }}' },
                { keyName: 'apply_state', keyValue: 'queued' },
              ],
            },
            columns: setColumns({ apply_state: '' }),
            options: {},
          },
          { alwaysOutputData: true },
        ),
        code('W9', 'Done', 'n8n/w9-robot/done.js', [1760, -1100]),
        answerQuery('W9', 'Answer', [1980, -1200], '={{ $json.queryId }}', '={{ $json.toast }}', {
          onError: 'continueRegularOutput',
        }),
        // 🚀 записан — сразу обработать очередь (ветка ниже: сначала ответ на нажатие и вид письма)
        node('W9', 'Tick?', 'if', 2.3, [1980, -950], ifTrue('W9', '={{ $json.tick }}')),

        // ---- Очередь: починка, ворота, захват, отклик, итог
        node('W9', 'Queue', 'dataTable', 1.1, [880, 0], {
          resource: 'row',
          operation: 'get',
          dataTableId: VACANCIES,
          matchType: 'allConditions',
          filters: { conditions: [{ keyName: 'apply_state', condition: 'isNotEmpty' }] },
          returnAll: true,
          orderBy: true,
          orderByColumn: 'apply_queued_at',
          orderByDirection: 'ASC',
        }),
        // Живые отклики робота за «день» — с 09:00 по Таиланду (02:00 UTC)
        node(
          'W9',
          'Today',
          'dataTable',
          1.1,
          [1100, 0],
          {
            resource: 'row',
            operation: 'get',
            dataTableId: VACANCIES,
            matchType: 'allConditions',
            filters: {
              conditions: [
                { keyName: 'apply_by', keyValue: 'robot' },
                {
                  keyName: 'applied_at',
                  condition: 'gte',
                  keyValue: '={{ new Date(Math.floor((Date.now() - 7200000) / 86400000) * 86400000 + 7200000).toISOString() }}',
                },
              ],
            },
            returnAll: true,
          },
          { executeOnce: true, alwaysOutputData: true },
        ),
        applierNode('W9', 'Health', [1320, 0], { path: '/health', timeout: 5000 }, { executeOnce: true }),
        code('W9', 'Gate', 'n8n/w9-robot/gate.js', [1540, 0]),
        node('W9', 'Heal?', 'if', 2.3, [1760, -400], ifTrue('W9', '={{ $json.heal.length > 0 }}')),
        code('W9', 'Heal items', 'n8n/w9-robot/heal-items.js', [1980, -400]),
        node('W9', 'Heal', 'dataTable', 1.1, [2200, -400], {
          resource: 'row',
          operation: 'update',
          dataTableId: VACANCIES,
          ...byId('={{ $json.id }}'),
          columns: setColumns({ apply_state: '={{ $json.to }}' }),
          options: {},
        }),
        // Блок сняли — прошлая тревога: «✅ Робот снова в работе», фото капчи — удалить
        node('W9', 'Resolved?', 'if', 2.3, [1760, -300], ifTrue('W9', '={{ Boolean($json.resolved) }}')),
        node('W9', 'Alert sent?', 'if', 2.3, [1980, -350], ifTrue('W9', '={{ Boolean($json.resolved.messageId) }}')),
        editMessage(
          'Alert: done',
          [2200, -350],
          { chatId: '={{ $env.TG_CHAT_ID }}', messageId: '={{ $json.resolved.messageId }}', text: '={{ $json.resolved.text }}', rows: null },
          'W9',
          { onError: 'continueRegularOutput' },
        ),
        node('W9', 'Prompt sent?', 'if', 2.3, [1980, -250], ifTrue('W9', '={{ Boolean($json.resolved.promptId) }}')),
        node(
          'W9',
          'Delete prompt',
          'telegram',
          1.2,
          [2200, -250],
          { resource: 'message', operation: 'deleteMessage', chatId: '={{ $env.TG_CHAT_ID }}', messageId: '={{ $json.resolved.promptId }}' },
          { credentials: TELEGRAM_CREDENTIAL, onError: 'continueRegularOutput' },
        ),
        // Сообщения: капча — фото с ForceReply; блок — тревога с ▶️; «не отвечает», «лимит» — текстом
        node('W9', 'Notice?', 'if', 2.3, [1760, -200], ifTrue('W9', '={{ Boolean($json.notice) }}')),
        code('W9', 'Notice item', 'n8n/w9-robot/notice-item.js', [1870, -700]),
        // Одна тревога на блок: параллельные запуски W9 (расписание + вызов себя) видят один блок, а «first» робот
        // отдаёт только одному. Робот не отвечает — отправляем (это и есть тревога «не отвечает»)
        applierNode('W9', 'Notice ack', [1980, -800], {
          method: 'POST',
          path: '/notice',
          body: `={{ JSON.stringify({ key: ${NOTICE}.key || '' }) }}`,
          timeout: 5000,
        }),
        node('W9', 'First?', 'if', 2.3, [2090, -700], ifTrue('W9', '={{ $json.first !== false }}')),
        node('W9', 'Notice kind', 'switch', 3.4, [2200, -700], {
          mode: 'expression',
          numberOutputs: 3,
          output: `={{ ({ captcha: 0, alert: 1, info: 2 })[${NOTICE}.kind] ?? 2 }}`,
          options: {},
        }),
        applierNode('W9', 'Get captcha', [2200, -800], { path: `/shots/{{ ${NOTICE}.shot }}`, timeout: 10000, file: true }),
        sendPhoto('W9', 'Captcha prompt', [2420, -800], {
          caption: `={{ ${NOTICE}.text }}`,
          fields: { disable_notification: `={{ ${NOTICE}.silent }}` },
          markup: { replyMarkup: 'forceReply', forceReply: { force_reply: true } },
        }),
        telegram('W9', 'Alert', [2200, -700], {
          text: `={{ ${NOTICE}.text }}`,
          fields: { disable_notification: `={{ ${NOTICE}.silent }}` },
          markup: { replyMarkup: 'inlineKeyboard', inlineKeyboard: keyboard([[['▶️ Продолжить', 'rb:go']]]) },
          extra: { onError: 'continueRegularOutput' },
        }),
        code('W9', 'Remember', 'n8n/w9-robot/remember.js', [2640, -750]),
        node('W9', 'Alert shot?', 'if', 2.3, [2860, -750], ifTrue('W9',
          `={{ ${NOTICE}.kind === 'alert' && Boolean(${NOTICE}.shot) }}`)),
        applierNode('W9', 'Get alert shot', [3080, -750], { path: `/shots/{{ ${NOTICE}.shot }}`, timeout: 10000, file: true }),
        sendPhoto('W9', 'Alert shot', [3300, -750], {
          caption: '📸 Экран робота',
          fields: { disable_notification: true, reply_to_message_id: "={{ $('Remember').first().json.messageId }}" },
        }),
        telegram('W9', 'Info', [2200, -600], {
          text: `={{ ${NOTICE}.text }}`,
          fields: { disable_notification: `={{ ${NOTICE}.silent }}` },
          extra: { onError: 'continueRegularOutput' },
        }),
        // Нажали 🚀, а робот ждёт — письмо сразу говорит, чего
        code('W9', 'Gate views', 'n8n/w9-robot/gate-views.js', [1760, -100]),
        node('W9', 'Next?', 'if', 2.3, [1760, 100], ifTrue('W9', '={{ Boolean($json.next) }}')),
        // Захват queued → applying: второй запуск W9 ту же вакансию уже не возьмёт (Update отдаёт только обновлённые)
        node('W9', 'Claim', 'dataTable', 1.1, [1980, 100], {
          resource: 'row',
          operation: 'update',
          dataTableId: VACANCIES,
          matchType: 'allConditions',
          filters: {
            conditions: [
              { keyName: 'id', keyValue: `={{ ${GATE}.next.id }}` },
              { keyName: 'apply_state', keyValue: 'queued' },
              { keyName: 'status', keyValue: 'approved' },
            ],
          },
          columns: setColumns({
            apply_state: 'applying',
            apply_tries: `={{ (Number(${GATE}.next.apply_tries) || 0) + 1 }}`,
          }),
          options: {},
        }),
        applierNode('W9', 'Apply', [2200, 100], {
          method: 'POST',
          path: '/apply',
          body: `={{ JSON.stringify({ vacancyId: ${GATE}.next.external_id, letter: ${GATE}.next.letter, requestId: ${GATE}.next.id + '-' + Date.now() }) }}`,
          timeout: 240000,
          full: true,
        }),
        code('W9', 'Result', 'n8n/w9-robot/result.js', [2420, 100]),
        node('W9', 'Save result', 'dataTable', 1.1, [2640, 100], {
          resource: 'row',
          operation: 'update',
          dataTableId: VACANCIES,
          ...byId('={{ $json.id }}'),
          columns: setColumns({
            status: '={{ $json.row.status }}',
            apply_state: '={{ $json.row.apply_state }}',
            apply_result: '={{ $json.row.apply_result }}',
            apply_letter: '={{ $json.row.apply_letter }}',
            apply_note: '={{ $json.row.apply_note }}',
            apply_by: '={{ $json.row.apply_by }}',
            applied_at: '={{ $json.row.applied_at }}',
            apply_tries: '={{ $json.row.apply_tries }}',
            has_test: '={{ $json.row.has_test }}',
            apply_type: '={{ $json.row.apply_type }}',
          }),
          options: {},
        }),
        node('W9', 'Card?', 'if', 2.3, [2640, 200], ifTrue('W9', '={{ Boolean($json.card) }}')),
        editMessage(
          'Card: done',
          [2860, 200],
          { chatId: '={{ $json.chatId }}', messageId: '={{ $json.card.messageId }}', text: '={{ $json.card.text }}', rows: null },
          'W9',
          { onError: 'continueRegularOutput' },
        ),
        node('W9', 'Shot?', 'if', 2.3, [2640, 300], ifTrue('W9', '={{ Boolean($json.shot) }}')),
        applierNode('W9', 'Get shot', [2860, 300], { path: '/shots/{{ $json.shot }}', timeout: 10000, file: true }),
        // Робот не смог, а повторить можно — на фото сразу [🚀 Ещё раз]: письмо с 🚀 выше и легко теряется
        node('W9', 'Retry shot?', 'if', 2.3, [3080, 300], ifTrue('W9', `={{ ${RESULT}.group === 'error' && ${RESULT}.layout === 'robot' }}`)),
        sendPhoto('W9', 'Send shot: retry', [3300, 250], {
          caption: `={{ ${RESULT}.caption }}`,
          fields: { disable_notification: true, reply_to_message_id: `={{ ${RESULT}.messageId }}` },
          markup: { replyMarkup: 'inlineKeyboard', inlineKeyboard: keyboard([[['🚀 Ещё раз', `=l:{{ ${RESULT}.id }}:robot`]]]) },
        }),
        sendPhoto('W9', 'Send shot', [3300, 350], {
          caption: `={{ ${RESULT}.caption }}`,
          fields: { disable_notification: true, reply_to_message_id: `={{ ${RESULT}.messageId }}` },
        }),
        code('W9', 'Sync job', 'n8n/w9-robot/sync-job.js', [2640, 400]),
        runWorkflow('W9', 'Panel sync', [2860, 400], IDS.menu),
        // Очередь не пуста — сразу следующий (новый запуск W9); после ошибки — ждём расписания
        node('W9', 'More?', 'if', 2.3, [2640, 500], ifTrue('W9', `={{ ${RESULT}.more }}`)),
        code('W9', 'Next job', 'n8n/w9-robot/next-job.js', [2860, 500]),
        runWorkflow('W9', 'Next tick', [3080, 500], IDS.robot),

        // ---- ▶️ / /go: робот перепроверяет вход и капчу, потом очередь
        applierNode('W9', 'Resume', [880, 1000], { method: 'POST', path: '/resume', timeout: 60000, full: true }),
        code('W9', 'Resume plan', 'n8n/w9-robot/resume-plan.js', [1100, 1000]),
        node('W9', 'Answer resume?', 'if', 2.3, [1320, 950], ifTrue('W9', `={{ Boolean(${JOB}.queryId) }}`)),
        answerQuery('W9', 'Answer resume', [1540, 950], `={{ ${JOB}.queryId }}`, "={{ $('Resume plan').first().json.toast }}", {
          onError: 'continueRegularOutput',
        }),
        node('W9', 'Resume reply?', 'if', 2.3, [1320, 1050], ifTrue('W9', '={{ Boolean($json.reply) }}')),
        telegram('W9', 'Resume reply', [1540, 1050], {
          text: '={{ $json.reply }}',
          fields: { disable_notification: true },
          markup: MENU_KEYBOARD,
          extra: { onError: 'continueRegularOutput' },
        }),
        node('W9', 'Then tick', 'noOp', 1, [1320, 1150], {}),

        // ---- Ответ на фото капчи: робот вводит текст; фото и ответ удаляются
        applierNode('W9', 'Captcha', [880, 1400], {
          method: 'POST',
          path: '/captcha',
          body: `={{ JSON.stringify({ text: ${JOB}.text }) }}`,
          timeout: 60000,
          full: true,
        }),
        code('W9', 'Captcha plan', 'n8n/w9-robot/captcha-plan.js', [1100, 1400]),
        code('W9', 'Delete ids', 'n8n/w9-robot/delete-ids.js', [1320, 1300]),
        node(
          'W9',
          'Delete msg',
          'telegram',
          1.2,
          [1540, 1300],
          { resource: 'message', operation: 'deleteMessage', chatId: '={{ $env.TG_CHAT_ID }}', messageId: '={{ $json.messageId }}' },
          { credentials: TELEGRAM_CREDENTIAL, onError: 'continueRegularOutput' },
        ),
        node('W9', 'Solved?', 'if', 2.3, [1320, 1400], ifTrue('W9', '={{ $json.solved }}')),
        // ForceReply спрятал кнопки меню — простое сообщение их возвращает
        telegram('W9', 'Captcha ok', [1540, 1400], {
          text: '={{ $json.text }}',
          fields: { disable_notification: true },
          markup: MENU_KEYBOARD,
          extra: { onError: 'continueRegularOutput' },
        }),
        node('W9', 'Then tick 2', 'noOp', 1, [1760, 1400], {}),
        node('W9', 'New captcha?', 'if', 2.3, [1540, 1500], ifTrue('W9', '={{ Boolean($json.notice) }}')),
        telegram('W9', 'Captcha fail', [1760, 1550], {
          text: '={{ $json.text }}',
          fields: { disable_notification: true },
          markup: MENU_KEYBOARD,
          extra: { onError: 'continueRegularOutput' },
        }),

        // ---- Робот выключен в ⚙️: очередь назад в ✅, письма — без 🚀
        node('W9', 'Queued', 'dataTable', 1.1, [880, 1700], {
          resource: 'row',
          operation: 'get',
          dataTableId: VACANCIES,
          matchType: 'allConditions',
          filters: { conditions: [{ keyName: 'apply_state', keyValue: 'queued' }] },
          returnAll: true,
        }),
        code('W9', 'Dequeue', 'n8n/w9-robot/dequeue.js', [1100, 1700]),
        node('W9', 'Unqueue all', 'dataTable', 1.1, [1320, 1700], {
          resource: 'row',
          operation: 'update',
          dataTableId: VACANCIES,
          matchType: 'allConditions',
          filters: {
            conditions: [
              { keyName: 'id', keyValue: '={{ $json.id }}' },
              { keyName: 'apply_state', keyValue: 'queued' },
            ],
          },
          columns: setColumns({ apply_state: '', apply_result: 'disabled' }),
          options: {},
        }),

        // ---- Вид письма — общий для всех веток
        ...view.nodes,
      ],
      [
        ['Called', 'Job'],
        ['Schedule', 'Job'],
        ['Manual', 'Job'],
        ['Job', 'Settings'],
        ['Settings', 'Op'],
        ['Op', 'Row', 0],
        ['Op', 'Queue', 1],
        ['Op', 'Resume', 2],
        ['Op', 'Captcha', 3],
        ['Op', 'Queued', 4],
        // 🚀 / ⛔
        ['Row', 'Plan'],
        ['Plan', 'Save?'],
        ['Save?', 'Enqueue', 0],
        ['Save?', 'Unqueue', 1],
        ['Save?', 'Done', 2],
        ['Enqueue', 'Done'],
        ['Unqueue', 'Done'],
        ['Done', 'View'],
        ['Done', 'Answer'],
        ['Done', 'Tick?'],
        ['Tick?', 'Queue', 0],
        // Очередь
        ['Queue', 'Today'],
        ['Today', 'Health'],
        ['Health', 'Gate'],
        ['Gate', 'Heal?'],
        ['Heal?', 'Heal items', 0],
        ['Heal items', 'Heal'],
        ['Gate', 'Resolved?'],
        ['Resolved?', 'Alert sent?', 0],
        ['Alert sent?', 'Alert: done', 0],
        ['Resolved?', 'Prompt sent?', 0],
        ['Prompt sent?', 'Delete prompt', 0],
        ['Gate', 'Notice?'],
        ['Notice?', 'Notice item', 0],
        ['Notice item', 'Notice ack'],
        ['Notice ack', 'First?'],
        ['First?', 'Notice kind', 0],
        ['Notice kind', 'Get captcha', 0],
        ['Get captcha', 'Captcha prompt'],
        ['Captcha prompt', 'Remember'],
        ['Notice kind', 'Alert', 1],
        ['Alert', 'Remember'],
        ['Remember', 'Alert shot?'],
        ['Alert shot?', 'Get alert shot', 0],
        ['Get alert shot', 'Alert shot'],
        ['Notice kind', 'Info', 2],
        ['Gate', 'Gate views'],
        ['Gate views', 'View'],
        ['Gate', 'Next?'],
        ['Next?', 'Claim', 0],
        ['Claim', 'Apply'],
        ['Apply', 'Result'],
        ['Result', 'View'],
        ['Result', 'Save result'],
        ['Result', 'Card?'],
        ['Card?', 'Card: done', 0],
        ['Result', 'Shot?'],
        ['Shot?', 'Get shot', 0],
        ['Get shot', 'Retry shot?'],
        ['Retry shot?', 'Send shot: retry', 0],
        ['Retry shot?', 'Send shot', 1],
        ['Result', 'Sync job'],
        ['Sync job', 'Panel sync'],
        ['Result', 'More?'],
        ['More?', 'Next job', 0],
        ['Next job', 'Next tick'],
        // ▶️ / /go
        ['Resume', 'Resume plan'],
        ['Resume plan', 'Answer resume?'],
        ['Answer resume?', 'Answer resume', 0],
        ['Resume plan', 'Resume reply?'],
        ['Resume reply?', 'Resume reply', 0],
        ['Resume plan', 'Then tick'],
        ['Then tick', 'Queue'],
        // Капча
        ['Captcha', 'Captcha plan'],
        ['Captcha plan', 'Delete ids'],
        ['Delete ids', 'Delete msg'],
        ['Captcha plan', 'Solved?'],
        ['Solved?', 'Captcha ok', 0],
        ['Captcha ok', 'Then tick 2'],
        ['Then tick 2', 'Queue'],
        ['Solved?', 'New captcha?', 1],
        ['New captcha?', 'Notice?', 0],
        ['New captcha?', 'Captcha fail', 1],
        // Робот выключен
        ['Queued', 'Dequeue'],
        ['Dequeue', 'Unqueue all'],
        ['Dequeue', 'View'],
        ...view.links,
      ],
      // Тики без очереди не храним: 1440 запусков в сутки. Static data (тревоги) сохраняется и так
      { timezone: 'Europe/Moscow', errorWorkflow: IDS.errors, saveDataSuccessExecution: 'none' },
    );
  })(),

  'w4-errors': workflow(
    IDS.errors,
    'W4 Errors',
    [
      node('W4', 'Error Trigger', 'errorTrigger', 1, [0, 0], {}),
      code('W4', 'Format error', 'n8n/w4-errors/format-error.js', [220, 0]),
      // Открытая тревога с тем же ключом — повтор той же проблемы (07.10.2026). Таблица не ответила —
      // тревога уходит как новая: лучше лишняя тревога, чем потерянная
      node(
        'W4',
        'Find alert',
        'dataTable',
        1.1,
        [440, 0],
        {
          resource: 'row',
          operation: 'get',
          dataTableId: ALERTS,
          matchType: 'allConditions',
          filters: {
            conditions: [
              { keyName: 'alert_key', keyValue: '={{ $json.key }}' },
              { keyName: 'is_open', condition: 'isTrue' },
            ],
          },
          returnAll: false,
          limit: 1,
          orderBy: true,
          orderByColumn: 'createdAt',
          orderByDirection: 'DESC',
        },
        { alwaysOutputData: true, onError: 'continueRegularOutput' },
      ),
      code('W4', 'Alert plan', 'n8n/w4-errors/alert-plan.js', [660, 0]),
      node('W4', 'Repeat?', 'if', 2.3, [880, 0], ifTrue('W4', '={{ $json.repeat }}')),
      // Повтор: правка той же тревоги — без звука, счётчик и время
      telegramEdit('W4', 'Edit alert', [1100, -100], { messageId: '={{ $json.tg_message_id }}', text: '={{ $json.text }}' }),
      node(
        'W4',
        'Save repeat',
        'dataTable',
        1.1,
        [1320, -100],
        {
          resource: 'row',
          operation: 'update',
          dataTableId: ALERTS,
          ...byId("={{ $('Alert plan').first().json.id }}"),
          columns: setColumns({
            hits: "={{ $('Alert plan').first().json.hits }}",
            last_at: "={{ $('Alert plan').first().json.now }}",
          }),
          options: {},
        },
        { onError: 'continueRegularOutput' },
      ),
      telegram('W4', 'Send alert', [1100, 100]),
      node(
        'W4',
        'Save alert',
        'dataTable',
        1.1,
        [1320, 100],
        {
          resource: 'row',
          operation: 'insert',
          dataTableId: ALERTS,
          columns: setColumns({
            alert_key: "={{ $('Alert plan').first().json.key }}",
            workflow: "={{ $('Alert plan').first().json.workflow }}",
            message: "={{ $('Alert plan').first().json.message }}",
            first_at: "={{ $('Alert plan').first().json.now }}",
            last_at: "={{ $('Alert plan').first().json.now }}",
            hits: '={{ 1 }}',
            is_open: '={{ true }}',
            tg_message_id: '={{ $json.result.message_id }}',
          }),
          options: {},
        },
        { onError: 'continueRegularOutput' },
      ),
    ],
    [
      ['Error Trigger', 'Format error'],
      ['Format error', 'Find alert'],
      ['Find alert', 'Alert plan'],
      ['Alert plan', 'Repeat?'],
      ['Repeat?', 'Edit alert', 0],
      ['Edit alert', 'Save repeat'],
      ['Repeat?', 'Send alert', 1],
      ['Send alert', 'Save alert'],
    ],
  ),
};

mkdirSync(`${ROOT}n8n/workflows`, { recursive: true });
for (const [file, wf] of Object.entries(workflows)) {
  writeFileSync(`${ROOT}n8n/workflows/${file}.json`, `${JSON.stringify(wf, null, 2)}\n`);
  console.log(`n8n/workflows/${file}.json  ${wf.name} (${wf.nodes.length} нод)`);
}
