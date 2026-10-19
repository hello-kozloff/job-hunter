// Тела запросов к нейросети «до символа» (19.10.2026, Claude по подписке — docs/claude-cli.md): при llm.provider = gemini
// и claude сборка W2 «Build prompt», W5 «Build letter» и общий llmBody (W11, W13) дают ровно те же тела, что до
// появления claude-cli. Эталон — scripts/test-llm.golden.json, снят с кода develop до изменений. Обновлять только
// осознанно: UPDATE_GOLDEN=1 node --test scripts/test-llm.mjs. Запуск: node --test scripts/test-llm.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runNode } from './lib/sandbox.mjs';

const GOLDEN = new URL('./test-llm.golden.json', import.meta.url);
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
const fresh = {};

const rows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));

// Выдуманные профили: фронтендер (пресет владельца) и generic с офисом и зарплатой (другие ветки промпта)
const FRONTEND = {
  'profile.ready': true,
  'profile.preset': 'frontend',
  'profile.resume': '# Иван Петров — Frontend-разработчик\n\n## Опыт работы\n### Альфа Софт (2022 — сейчас)\n- Перевёл личный кабинет банка на React и Next.js, загрузка с 6 до 2 секунд.\n- Дизайн-система на 60 компонентов.\n### Бета Лабс (2020 — 2022)\n- 30+ лендингов на React.\n\n## Навыки\nReact, Next.js, TypeScript, Node.js, NestJS, Docker',
  'profile.extra': 'Пет-проекты: бот на NestJS и PostgreSQL.',
  'profile.facts': {
    name: 'Иван Петров', first_name: 'Иван', gender: 'm', position: 'Frontend-разработчик', level: 'senior', years: 5,
    skills: ['React', 'TypeScript'], companies: ['Альфа Софт', 'Бета Лабс'], english: 'B1', formats: ['REMOTE'],
  },
  'profile.signature': 'Иван',
  'profile.contact': 'Для быстрой связи тг: @ivan_dev',
  'llm.cases': [
    { case: 'Vue без React', decision: 'apply' },
    { case: 'fullstack', decision: 'maybe' },
    { case: 'AI на JS/TS', decision: 'apply' },
  ],
};
const GENERIC = {
  'profile.ready': true,
  'profile.preset': 'generic',
  'profile.resume': 'Мария Смирнова — бухгалтер. 7 лет: 1С, первичка, НДС, отчётность. Работала в «Вектор» и «Сигма».',
  'profile.facts': { name: 'Мария Смирнова', gender: 'f', position: 'Бухгалтер', years: 7, companies: ['Вектор', 'Сигма'], city: 'Казань', salary: { amount: 90000, currency: 'RUR' } },
  'profile.about': ['Ищет офис или гибрид в Казани.'],
  'search.formats': ['ON_SITE', 'HYBRID'],
  'llm.rules': { skip: ['стажировки'], maybe: ['главный бухгалтер'], apply: ['бухгалтер на участок'], ignore: ['1С:ЗУП'] },
  'profile.signature': 'Мария',
  'profile.contact': 'm.smirnova@example.com',
};

const VACANCIES = [
  {
    id: 11, title: 'Senior Frontend-разработчик (React)', company: 'Гамма Тех', experience: 'between3And6', work_formats: 'REMOTE',
    employment_form: 'FULL', areas: 'Москва', languages: 'en:B1', key_skills: 'React, TypeScript, Next.js', url: 'https://hh.ru/vacancy/11',
    description: 'Развитие клиентской части на React и Next.js, перевод legacy на TypeScript, дизайн-система. GraphQL будет плюсом.',
    status: 'approved', resume_id: '', letter: '', letter_notes: '',
  },
  {
    id: 12, title: 'AI Engineer (LLM, агенты)', company: 'Дельта', experience: 'between1And3', work_formats: 'REMOTE,HYBRID',
    employment_form: 'FULL', areas: 'Москва, Санкт-Петербург', key_skills: 'Node.js, LLM, RAG', url: 'https://hh.ru/vacancy/12',
    description: 'Интеграции LLM в продукт на NestJS, RAG, агенты.', status: 'approved', resume_id: '',
    letter: 'Здравствуйте!\n\nВ Альфа Софт перевёл кабинет банка на Next.js. Ещё делал бота на NestJS.',
    letter_notes: 'я знаю LangChain | короче',
  },
  { id: 13, title: 'Frontend-разработчик', company: 'Эпсилон', snippet: 'React, Redux', areas: 'Минск', status: 'approved', resume_id: '', letter: '', letter_notes: '' },
];
const OFFICE_VACANCY = {
  id: 21, title: 'Бухгалтер на участок', company: 'Омега', experience: 'between3And6', work_formats: 'ON_SITE', employment_form: 'FULL',
  areas: 'Казань', salary_from: 80000, salary_to: 110000, currency: 'RUR', salary_gross: false, key_skills: '1С, НДС',
  description: 'Первичка, банк, сверки.', status: 'approved', resume_id: '', letter: '', letter_notes: '',
};

const ENV = { TG_CHAT_ID: '1' };
// Math.random фиксируем: «🔄» берёт случайный зачин и seed Gemini
async function seeded(fn) {
  const real = Math.random;
  Math.random = () => 0.25;
  try {
    return await fn();
  } finally {
    Math.random = real;
  }
}

const score = (profile, provider, claim) =>
  runNode('n8n/w2-score/build-prompt.js', { nodes: { Claim: claim, Settings: rows({ ...profile, 'llm.provider': provider }) }, env: ENV });
const letter = (profile, provider, jobs, vacancy) =>
  seeded(() =>
    runNode('n8n/w5-letter/build-letter.js', { nodes: { Jobs: jobs, Vacancy: vacancy, Settings: rows({ ...profile, 'llm.provider': provider }) }, env: ENV }),
  );

// llm.js — текст, который сборщик вставляет в Code-ноды W11 и W13: грузим как текст, как test-shared.mjs ($env — параметр)
const LLM_JS = readFileSync(new URL('../n8n/shared/llm.js', import.meta.url), 'utf8');
const loadLlm = (env) => new Function('$env', `${LLM_JS}\nreturn { llmBody, llmModel };`)(env);
const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    level: { type: 'string', enum: ['junior', 'middle', 'senior'] },
    years: { type: 'number' },
    remote: { type: 'boolean' },
    skills: { type: 'array', items: { type: 'string' } },
    places: { type: 'array', items: { type: 'object', properties: { company: { type: 'string' }, from: { type: 'number' } } } },
  },
};
function llmBodies(provider) {
  const { llmBody, llmModel } = loadLlm({});
  const model = llmModel(provider);
  return [
    { model, body: llmBody({ provider, model, system: 'Разбери резюме.', user: '<resume>текст</resume>', schema: SCHEMA }) },
    { model, body: llmBody({ provider, model, system: 'Правки.', user: 'резюме', schema: SCHEMA, maxTokens: 8192, temperature: 0.2 }) },
  ];
}

const CASES = {
  'w2 frontend gemini': () => score(FRONTEND, 'gemini', VACANCIES),
  'w2 frontend claude': () => score(FRONTEND, 'claude', VACANCIES),
  'w2 generic gemini': () => score(GENERIC, 'gemini', [OFFICE_VACANCY]),
  'w2 generic claude': () => score(GENERIC, 'claude', [OFFICE_VACANCY]),
  'w5 new gemini': () => letter(FRONTEND, 'gemini', [{ id: 11, mode: 'new', instruction: '' }], VACANCIES),
  'w5 new claude': () => letter(FRONTEND, 'claude', [{ id: 11, mode: 'new', instruction: '' }], VACANCIES),
  'w5 redo gemini': () => letter(FRONTEND, 'gemini', [{ id: 12, mode: 'redo', instruction: '' }], VACANCIES),
  'w5 redo claude': () => letter(FRONTEND, 'claude', [{ id: 12, mode: 'redo', instruction: '' }], VACANCIES),
  'w5 revise gemini': () => letter(FRONTEND, 'gemini', [{ id: 12, mode: 'revise', instruction: 'Я знаю PHP, напиши про это' }], VACANCIES),
  'w5 revise claude': () => letter(FRONTEND, 'claude', [{ id: 12, mode: 'revise', instruction: 'Я знаю PHP, напиши про это' }], VACANCIES),
  'w5 generic gemini': () => letter(GENERIC, 'gemini', [{ id: 21, mode: 'new', instruction: '' }], [OFFICE_VACANCY]),
  'llm.js gemini': async () => llmBodies('gemini'),
  'llm.js claude': async () => llmBodies('claude'),
};

for (const [name, build] of Object.entries(CASES)) {
  test(`golden: ${name}`, async () => {
    const out = await build();
    // Тела — строкой: ключи в том же порядке, что уходят в HTTP Request (JSON.stringify($json.body))
    const actual = out.map((item) => ({ ...item, body: JSON.stringify(item.body) }));
    fresh[name] = actual;
    if (UPDATE) return;
    assert.ok(golden[name], `нет эталона для «${name}»: UPDATE_GOLDEN=1 node --test scripts/test-llm.mjs`);
    assert.deepEqual(actual, golden[name]);
  });
}

test.after(() => {
  if (UPDATE) writeFileSync(GOLDEN, `${JSON.stringify(fresh, null, 1)}\n`);
});

// ---------- Claude по подписке (сервис claude-cli, docs/claude-cli.md) ----------

const CLI = { 'llm.cli_score': 'claude-haiku-5-5', 'llm.cli_text': 'claude-sonnet-5-5' };
const cliScore = (profile, claim) =>
  runNode('n8n/w2-score/build-prompt.js', { nodes: { Claim: claim, Settings: rows({ ...profile, ...CLI, 'llm.provider': 'claude-cli' }) }, env: ENV });
const cliLetter = (jobs, vacancy) =>
  seeded(() =>
    runNode('n8n/w5-letter/build-letter.js', { nodes: { Jobs: jobs, Vacancy: vacancy, Settings: rows({ ...FRONTEND, ...CLI, 'llm.provider': 'claude-cli' }) }, env: ENV }),
  );

test('claude-cli W2: тело Claude API с моделью оценки + задача, усилие, срок; запасной Gemini — то же тело, что у gemini', async () => {
  const [cli] = await cliScore(FRONTEND, VACANCIES.slice(0, 1));
  const [gem] = await score(FRONTEND, 'gemini', VACANCIES.slice(0, 1));
  const [api] = await score(FRONTEND, 'claude', VACANCIES.slice(0, 1));
  assert.equal(cli.provider, 'claude-cli');
  assert.equal(cli.model, 'claude-haiku-5-5');
  const { task, effort, deadline_ms: wait, fallback, ...claude } = cli.body;
  assert.deepEqual({ task, effort, wait }, { task: 'score', effort: 'low', wait: 170000 });
  assert.deepEqual(claude, { ...api.body, model: 'claude-haiku-5-5' });
  assert.equal(fallback.model, 'gemini-3.5-flash-lite');
  assert.equal(JSON.stringify(fallback.body), JSON.stringify(gem.body));
  assert.equal(cli.prompt_v, gem.prompt_v);
});

test('claude-cli W5: модель текстов; запасной Gemini «🔄» — с тем же seed и зачином, что у gemini', async () => {
  const job = [{ id: 12, mode: 'redo', instruction: '' }];
  const [cli] = await cliLetter(job, VACANCIES);
  const [gem] = await letter(FRONTEND, 'gemini', job, VACANCIES);
  assert.equal(cli.model, 'claude-sonnet-5-5');
  assert.equal(cli.body.task, 'text');
  assert.equal(JSON.stringify(cli.body.fallback.body), JSON.stringify(gem.body));
  assert.ok(cli.body.fallback.body.generationConfig.seed >= 0);
});

test('claude-cli llm.js (W11, W13): модель текстов из настроек, запасной Gemini — модель профиля, свой срок у W13', () => {
  const { llmBody, llmModel } = loadLlm({ GEMINI_PROFILE_MODEL: 'gemini-3.5-flash' });
  const settings = { 'llm.cli_text': 'claude-opus-5-5' };
  assert.equal(llmModel('claude-cli', settings), 'claude-opus-5-5');
  assert.equal(llmModel('claude-cli'), 'claude-sonnet-5-5');
  const body = llmBody({ provider: 'claude-cli', model: 'claude-opus-5-5', system: 's', user: 'u', schema: SCHEMA, settings, deadlineMs: 290000 });
  assert.equal(body.deadline_ms, 290000);
  assert.equal(body.task, 'text');
  assert.equal(body.fallback.model, 'gemini-3.5-flash');
  assert.deepEqual(body.fallback.body, llmBody({ provider: 'gemini', model: 'x', system: 's', user: 'u', schema: SCHEMA }));
  assert.equal(body.output_config.format.schema.additionalProperties, false);
});

// Ответы сервиса: CLI ответил (форма Claude API), запасной Gemini, ошибка без запасного пути
const cliOk = (answer, model = 'claude-haiku-5-5') => ({
  statusCode: 200,
  body: { provider: 'claude-cli', model, type: 'message', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn' },
});
const viaGemini = (answer, reason = 'limit') => ({
  statusCode: 200,
  body: {
    candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }],
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    fallback: { reason, until: '2026-10-19T08:00:00.000Z', note: 'лимит подписки до 15:00' },
  },
});
const cliError = (statusCode, message) => ({
  statusCode,
  body: { type: 'error', error: { type: 'x', message: `Claude по подписке: ${message}` }, provider: 'claude-cli', model: 'claude-haiku-5-5' },
});

const verdicts = async (responses) => {
  const claim = VACANCIES.slice(0, responses.length);
  const prompts = claim.map((r) => ({ id: r.id, provider: 'claude-cli', model: 'claude-haiku-5-5', prompt_v: 'v1' }));
  return runNode('n8n/w2-score/parse-verdict.js', { nodes: { 'Build prompt': prompts, Claim: claim }, input: responses, env: ENV });
};

test('W2 Parse verdict: ответ Claude, запасной Gemini, лимит и вход без запасного пути, сервис лёг', async () => {
  const [ok, gem, limit] = await verdicts([cliOk({ reason: 'React', decision: 'apply' }), viaGemini({ reason: 'g', decision: 'maybe' }), cliError(429, 'лимит подписки до 15:00')]);
  assert.deepEqual([ok.outcome, ok.decision, ok.llm_model, ok.fallback], ['scored', 'apply', 'claude-haiku-5-5', undefined]);
  assert.deepEqual([gem.outcome, gem.decision, gem.llm_model, gem.fallback.reason], ['scored', 'maybe', 'gemini-3.5-flash-lite', 'limit']);
  assert.deepEqual([limit.outcome, limit.problem, limit.note], ['quota', 'cli', 'Claude по подписке: лимит подписки до 15:00']);
  const [auth, down, net] = await verdicts([cliError(401, 'вход не работает'), cliError(503, 'сервер Claude не ответил'), { error: { message: 'getaddrinfo ENOTFOUND claude-cli' } }]);
  assert.deepEqual([auth.outcome, auth.problem], ['retry', 'cli-auth']);
  assert.deepEqual([down.outcome, down.problem], ['retry', 'сервер нейросети: HTTP 503']);
  assert.equal(net.outcome, 'retry');
  assert.match(net.problem, /^сеть: сервис Claude по подписке \(claude-cli\) не отвечает — getaddrinfo ENOTFOUND/);
});

const letters = (responses, provider = 'claude-cli') =>
  runNode('n8n/w5-letter/parse-letter.js', {
    nodes: {
      'Build letter': responses.map(() => ({ id: 11, mode: 'new', provider, model: provider === 'claude-cli' ? 'claude-sonnet-5-5' : 'gemini-3.5-flash-lite', said: [] })),
      Vacancy: [VACANCIES[0]],
      Settings: rows(FRONTEND),
    },
    input: responses,
    env: ENV,
  });
const PLAN = { needs: ['React'], matches: [{ need: 'React', fact: 'Альфа Софт' }], first: 'В Альфа Софт перевёл кабинет на Next.js.', second: 'Делал дизайн-систему.', closing: 'Расскажу подробнее.' };

test('W5 Parse letter: модель письма из ответа сервиса, запасной Gemini помечен, ошибка — текстом сервиса', async () => {
  const [ok, gem, limit] = await letters([cliOk(PLAN, 'claude-sonnet-5-5'), viaGemini(PLAN), cliError(429, 'лимит подписки до 15:00')]);
  assert.equal(ok.ok, true);
  assert.equal(ok.letter_model, 'claude-sonnet-5-5');
  assert.match(ok.letter, /^Здравствуйте!\n\nВ Альфа Софт/);
  assert.equal(gem.letter_model, 'gemini-3.5-flash-lite');
  assert.equal(gem.fallback.note, 'лимит подписки до 15:00');
  assert.equal(limit.ok, false);
  assert.equal(limit.problem, 'Claude по подписке: лимит подписки до 15:00');
  const [plain] = await letters([{ statusCode: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(PLAN) }] } }] } }], 'gemini');
  assert.equal(plain.letter_model, 'gemini-3.5-flash-lite');
  assert.equal(plain.fallback, undefined);
});

test('llmJson (W11, W13): ответ Claude по подписке, запасной Gemini, ошибка сервиса, сервис не отвечает', () => {
  const { llmJson } = new Function('$env', `${LLM_JS}\nreturn { llmJson };`)({});
  assert.deepEqual(llmJson(cliOk({ a: 1 }), 'claude-cli'), { answer: { a: 1 } });
  assert.deepEqual(llmJson(viaGemini({ a: 2 }), 'claude-cli'), { answer: { a: 2 } });
  assert.deepEqual(llmJson(cliError(429, 'лимит подписки до 15:00'), 'claude-cli', 'повтори позже'), { problem: 'Claude по подписке: лимит подписки до 15:00 — повтори позже' });
  assert.match(llmJson({ error: { message: 'ECONNREFUSED' } }, 'claude-cli').problem, /^сервис Claude по подписке не отвечает \(ECONNREFUSED\)/);
  // Ошибка запасного Gemini — как ошибка Gemini
  assert.match(llmJson({ statusCode: 429, body: { provider: 'gemini', error: { message: 'quota' } } }, 'claude-cli').problem, /^лимит запросов к нейросети \(429\)/);
});

test('шапка письма: модель мелко и после перерисовки, строка запасного Gemini — только с fallback', () => {
  const lib = new Function(
    `${['n8n/shared/time.js', 'n8n/shared/card.js', 'n8n/shared/letter.js'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n')}\nreturn { letterText, modelLabel };`,
  )();
  assert.equal(lib.modelLabel('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(lib.modelLabel('gemini-3.5-flash-lite'), 'Gemini 3.5 Flash-Lite');
  assert.equal(lib.modelLabel('claude-haiku-4-5'), 'Haiku 4.5');
  assert.equal(lib.modelLabel(''), '');
  const r = { ok: true, mode: 'new', url: 'https://hh.ru/vacancy/11', title: 'Frontend', company: 'Гамма', letter: 'Здравствуйте!', status: 'approved' };
  const text = lib.letterText({ ...r, letter_model: 'claude-sonnet-5-5' });
  assert.match(text.split('\n')[0], /· Гамма · <i>Sonnet 5\.5<\/i>$/);
  assert.doesNotMatch(text, /письмо написал Gemini/);
  const fallback = lib.letterText({ ...r, letter_model: 'gemini-3.5-flash-lite', fallback: { note: 'лимит подписки до 15:00' } });
  assert.match(fallback, /<i>Gemini 3\.5 Flash-Lite<\/i>\n⚠️ Claude по подписке: лимит подписки до 15:00 — письмо написал Gemini\./);
  assert.doesNotMatch(lib.letterText(r).split('\n')[0], /<i>/, 'old letters without letter_model have no label');
});
