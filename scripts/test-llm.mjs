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
