// W2 «Summary»: тревоги про нейросеть (запуск — node --test scripts/test-w2.mjs).
// Временные сбои Gemini (503, таймаут, сеть) — тихая строка, громко только если не проходит несколько запусков подряд.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNode } from './lib/sandbox.mjs';

const REPORT = '🔎 Сбор 13:30 МСК · новых 1';
const row = (id, extra) => ({ id, title: `Вакансия ${id}`, llm_model: 'gemini-3.5-flash-lite', ...extra });
const timeout = (id) => row(id, { outcome: 'retry', problem: 'сеть: The connection was aborted, perhaps the server is offline' });
const overload = (id) => row(id, { outcome: 'retry', problem: 'сервер нейросети: HTTP 503' });
const scored = (id) => row(id, { outcome: 'scored', decision: 'apply', llm_reason: 'ок' });

// Один запуск W2: results — «Parse verdict»; state — static data между запусками
async function run(results, state, report = REPORT, { at, quietSkips = 0 } = {}) {
  const realNow = Date.now;
  if (at) Date.now = () => Date.parse(at);
  try {
    return await runNode('n8n/w2-score/summary.js', {
      input: [{ report }],
      nodes: {
        'Parse verdict': results,
        Claim: results.map((r) => ({ id: r.id })),
        ...(quietSkips && { 'Quiet skips': Array.from({ length: quietSkips }, (_, i) => ({ id: 100 + i })) }),
      },
      state,
      env: { USER_TZ: 'Asia/Bangkok' },
    });
  } finally {
    Date.now = realNow;
  }
}
const loud = (messages) => messages.filter((m) => !m.report && !m.silent);

test('one timeout: no loud alert, a quiet line in the live collect message', async () => {
  const state = {};
  const messages = await run([timeout(1)], state);
  assert.equal(loud(messages).length, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].silent, true);
  assert.equal(messages[0].live, true);
  assert.match(messages[0].text, /🔎 Сбор/);
  assert.match(messages[0].text, /Нейросеть: сеть: The connection was aborted.*Не оценено 1 — повторю в следующий запуск/);
  assert.equal(state.llmFails, 1);
});

test('503 «high demand»: quiet too', async () => {
  const messages = await run([overload(1), overload(2)], {});
  assert.equal(loud(messages).length, 0);
  assert.match(messages[0].text, /сервер нейросети: HTTP 503. Не оценено 2/);
});

test('three runs in a row without any answer: the third one is loud, then once in 8 runs', async () => {
  const state = {};
  const alerts = [];
  for (let n = 1; n <= 12; n++) {
    const m = await run([timeout(n)], state);
    if (loud(m).length) alerts.push(n);
  }
  assert.deepEqual(alerts, [3, 11]);
  const m = await run([timeout(13)], {});
  assert.equal(loud(m).length, 0, 'a fresh counter starts from zero');
});

test('the loud alert says how long and what to do', async () => {
  const state = { llmFails: 2 };
  const [alert] = loud(await run([timeout(1), timeout(2)], state));
  assert.equal(alert.silent, false);
  assert.match(alert.text, /не отвечает уже 3 запусков подряд/);
  assert.match(alert.text, /Не оценено 2/);
  assert.match(alert.text, /⚙️ Настройки → 🤖 Нейросеть/);
});

test('an answer resets the counter; a partial failure stays quiet', async () => {
  const state = { llmFails: 2 };
  const messages = await run([scored(1), timeout(2)], state);
  assert.equal(state.llmFails, 0);
  assert.equal(loud(messages).length, 0);
  const text = messages.map((m) => m.text).join('\n');
  assert.match(text, /📊 Оценено 1/);
  assert.match(text, /Нейросеть: сеть:.*Не оценено 1/);
  // и после ответа счёт идёт заново
  const again = await run([timeout(3)], state);
  assert.equal(state.llmFails, 1);
  assert.equal(loud(again).length, 0);
});

test('a run with nothing to score does not touch the counter', async () => {
  const state = { llmFails: 2 };
  await run([], state);
  assert.equal(state.llmFails, 2);
});

test('problems that need action are loud at once (key, access, unexpected answer)', async () => {
  for (const problem of ['HTTP 403: API key not valid', 'HTTP 401: invalid x-api-key', 'HTTP 404: model not found']) {
    const state = {};
    const messages = await run([row(1, { outcome: 'retry', problem })], state);
    const alerts = loud(messages);
    assert.equal(alerts.length, 1, problem);
    assert.match(alerts[0].text, new RegExp(`Нейросеть: ${problem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(state.llmFails ?? 0, 0, 'not a transient failure');
  }
});

test('quota 429 is unchanged: loud at once', async () => {
  const messages = await run([row(1, { outcome: 'quota', problem: 'day' })], {});
  const alerts = loud(messages);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /исчерпан дневной лимит запросов/);
});

test('no transient failures: messages are exactly as before', async () => {
  const messages = await run([scored(1), scored(2)], {});
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /^🔎 Сбор 13:30 МСК · новых 1\n\n📊 Оценено 2: 🟢 2 · 🟡 0 · 🔴 0$/);
  const none = await run([], {});
  assert.equal(none.length, 1);
  assert.equal(none[0].text, REPORT);
});

// 16.10.2026: счётчик skip без карточек (quiet) затенял тихие часы — итог оценки ночью приходил со звуком
const NIGHT = '2026-10-16T20:00:00Z'; // 03:00 в Таиланде
const DAY = '2026-10-16T06:00:00Z'; // 13:00 в Таиланде

test('summary of scored vacancies: silent at night, with sound in the daytime', async () => {
  const night = await run([scored(1)], {}, REPORT, { at: NIGHT });
  assert.equal(night[0].silent, true);
  const day = await run([scored(1)], {}, REPORT, { at: DAY });
  assert.equal(day[0].silent, false);
});

test('summary with skips without cards stays silent in the daytime too (as before)', async () => {
  const day = await run([scored(1), scored(2)], {}, REPORT, { at: DAY, quietSkips: 2 });
  assert.equal(day[0].silent, true);
  assert.match(day[0].text, /🔴 2 без карточек/);
});

test('without a report (manual run) the summary keeps the same quiet rules', async () => {
  const night = await run([scored(1)], {}, '', { at: NIGHT });
  assert.equal(night[0].silent, true);
  assert.equal(night[0].report, false);
});

// Промпт оценки после разбора теневого режима (19.10.2026): AI на любом языке, fullstack на Node/Python — apply,
// ТК и льготы — не привязка; пресет generic не меняется
const settingRows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));
const FRONT = {
  'profile.preset': 'frontend',
  'profile.resume': 'Frontend React',
  'profile.about': ['Senior Frontend'],
  'profile.facts': { country_gen: 'Таиланда', citizenship: 'РФ' },
};
const GENERIC = {
  'profile.preset': 'generic',
  'profile.resume': 'Дизайнер интерфейсов. Figma, прототипы.',
  'profile.about': ['Дизайнер интерфейсов, 5 лет'],
  'llm.rules': { skip: ['не дизайн'], maybe: ['гибрид'], apply: ['продуктовый дизайн'], ignore: ['зарплата'], notes: [] },
  'llm.cases': [],
};
const prompt = (settings, vacancy = { id: 1, title: 'Frontend-разработчик', key_skills: 'React' }) =>
  runNode('n8n/w2-score/build-prompt.js', { nodes: { Claim: [vacancy], Settings: settingRows(settings) } }).then(([out]) => ({
    v: out.prompt_v,
    system: out.body.systemInstruction.parts[0].text,
    text: out.body.contents[0].parts[0].text,
  }));

test('промпт frontend: AI на любом языке, fullstack на Node/Python — apply, ТК и льготы — не привязка', async () => {
  const { system } = await prompt(FRONT);
  assert.ok(!/AI на Python, Go, Java и т\. п\. — skip/.test(system));
  assert.ok(!/где основной язык не JS\/TS/.test(system));
  assert.match(system, /разработку на AI \(интеграции LLM, AI-агенты, в том числе голосовые, RAG\) на любом языке/);
  assert.match(system, /apply и тогда, когда это fullstack: React или Vue в обязательных требованиях и бэкенд на Node\.js \(NestJS, Express\) или Python/);
  assert.match(system, /- fullstack, где бэкенд не на Node\.js и не на Python/);
  assert.ok(!/льготы для жителей РФ \(ИТ-ипотека, отсрочка, бронь от мобилизации\); трудоустройство/.test(system), 'льготы и ТК — не в maybe');
  assert.match(system, /по трудовому кодексу любой страны \(ТК РФ, ТК РБ, ТК РУз…\)/);
  assert.match(system, /запрет работать из России или Беларуси \(«не из РФ», «кроме РФ и РБ», «any location except Russia and Belarus»\): это про место работы, а не гражданство — кандидат работает из Таиланда/);
  assert.match(system, /не берут граждан РФ \(именно гражданство, а не место работы\): у кандидата гражданство РФ/);
  assert.ok(!/Поправки кандидата/.test(system), 'список по умолчанию — без поправок');
});

test('промпт frontend: прежние подписи случаев — тот же prompt_v, что новые умолчания', async () => {
  const fresh = await prompt(FRONT);
  const legacy = await prompt({
    ...FRONT,
    'llm.cases': [
      { case: 'Vue без React', decision: 'maybe' },
      { case: 'fullstack', decision: 'maybe' },
      { case: 'AI на JS/TS', decision: 'apply' },
      { case: 'React Native', decision: 'skip' },
    ],
  });
  assert.equal(legacy.v, fresh.v);
  assert.ok(!/Поправки кандидата/.test(legacy.system));
});

test('подсказка про AI — только у AI-вакансий и только пока случай в списке', async () => {
  const ai = { id: 2, title: 'AI Engineer (Python)', key_skills: 'LLM, RAG' };
  let { text } = await prompt(FRONT, ai);
  assert.match(text, /Подсказка отбора: .* на любом языке, решение apply, даже если это бэкенд или стек не JS\/TS/);
  ({ text } = await prompt(FRONT));
  assert.ok(!/Подсказка отбора/.test(text));
  ({ text } = await prompt({ ...FRONT, 'llm.cases': [{ case: 'Vue без React', decision: 'maybe' }] }, ai));
  assert.ok(!/Подсказка отбора/.test(text), 'случай убран из списка — подсказки нет');
});

test('промпт generic не изменился (prompt_v снят на develop до правки 19.10.2026)', async () => {
  assert.equal((await prompt(GENERIC)).v, '1i55scj');
});
