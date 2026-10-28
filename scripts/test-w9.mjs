// W9 / W5: каким резюме откликается робот (запуск — node --test scripts/test-w9.mjs).
// Резюме вакансии, связанное с резюме на hh, робот выбирает в окне отклика; не связанное — роботу нельзя.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runNode } from './lib/sandbox.mjs';

const HA = 'a'.repeat(38);
const HB = 'b'.repeat(38);
const rows = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));
const setup = (extra = {}) =>
  rows({
    'profile.ready': true,
    'apply.enabled': true,
    'apply.daily_limit': 25,
    resumes: [
      { id: 'r1', name: 'Frontend', active: true, hh: { hash: HA, title: 'Frontend-разработчик' } },
      { id: 'r2', name: 'Дизайнер', active: true, hh: null },
      { id: 'r3', name: 'Fullstack', active: true, hh: { hash: HB, title: 'Fullstack-разработчик' } },
    ],
    'resume.r2': { resume: 'x', in_name: ['дизайнер'] },
    'resume.r3': { resume: 'y', in_name: ['fullstack'] },
    ...extra,
  });
const vacancy = (extra = {}) => ({
  id: 7, external_id: '138000001', title: 'Вакансия', company: 'К', url: 'https://hh.ru/vacancy/138000001', apply_url: 'https://hh.ru/applicant/vacancy_response?vacancyId=138000001',
  status: 'approved', letter: 'Здравствуйте!', has_test: false, apply_type: 'hh', apply_state: '', tg_letter_id: 55, ...extra,
});
const plan = (row, settings = setup()) =>
  runNode('n8n/w9-robot/plan.js', {
    input: [row],
    nodes: { Job: { op: 'enqueue', id: 7, chatId: '1', messageId: 9, queryId: 'q' }, Settings: settings.map((r) => r) },
  }).then(([out]) => out);

test('🚀: основное резюме, связанное с hh, и второе, связанное с hh, — в очередь', async () => {
  for (const resume_id of ['', 'r1', 'r3']) {
    const out = await plan(vacancy({ resume_id }));
    assert.equal(out.ok, true, `resume_id=${JSON.stringify(resume_id)}`);
    assert.equal(out.save, 'enqueue');
    assert.equal(out.layout, 'wait');
  }
});

test('🚀: основное резюме без привязки к hh — как раньше (робот откликнется резюме по умолчанию)', async () => {
  const settings = setup({ resumes: [{ id: 'r1', name: 'Frontend', active: true, hh: null }] });
  const out = await plan(vacancy(), rows({ ...Object.fromEntries(settings.map((r) => [r.name, JSON.parse(r.value_json)])) }));
  assert.equal(out.ok, true);
});

test('🚀: другое резюме без привязки к hh — отказ с причиной, письмо без 🚀', async () => {
  const out = await plan(vacancy({ resume_id: 'r2' }));
  assert.equal(out.ok, false);
  assert.equal(out.save, '');
  assert.equal(out.layout, 'manual');
  assert.match(out.toast, /Резюме не связано с hh/);
  assert.match(out.text, /Робот не откликается: резюме «Дизайнер» не связано с резюме на hh: импортируйте его/);
  // удалённое резюме — как основное: вакансия остаётся в работе
  assert.equal((await plan(vacancy({ resume_id: 'r9' }))).ok, true);
});

// Очередь робота (Gate): кого отправлять и каким резюме
const gate = (queue, settings = setup(), state = {}) =>
  runNode('n8n/w9-robot/gate.js', {
    nodes: { Job: { op: 'tick', fromUser: false }, Settings: settings, Queue: queue, Today: [{}], 'Remind queue': [{}], 'Remind today': [{}], Health: { ok: true, busy: false } },
    state,
  }).then(([out]) => out);

test('Gate: next несёт резюме для робота; без привязки основного — пусто', async () => {
  const q = (resume_id, id = 1) => vacancy({ id, resume_id, apply_state: 'queued', updatedAt: new Date().toISOString() });
  let out = await gate([q('r3')]);
  assert.deepEqual(out.next.resume, { hash: HB, title: 'Fullstack-разработчик' });
  out = await gate([q('')]);
  assert.deepEqual(out.next.resume, { hash: HA, title: 'Frontend-разработчик' });
  const unlinkedMain = setup({ resumes: [{ id: 'r1', name: 'Frontend', active: true, hh: null }] });
  out = await gate([q('')], unlinkedMain);
  assert.equal(out.next.resume, null);
  assert.equal(out.next.id, 1);
});

test('Gate: в очереди резюме, которое расстались с hh, — снять и не отправлять', async () => {
  const stale = vacancy({ id: 5, resume_id: 'r2', apply_state: 'queued', updatedAt: new Date().toISOString() });
  const good = vacancy({ id: 6, resume_id: 'r3', apply_state: 'queued', updatedAt: new Date().toISOString() });
  const out = await gate([stale, good]);
  assert.deepEqual(out.heal, [{ id: 5, to: '' }]);
  assert.equal(out.next.id, 6);
});

// Запрос к роботу: резюме уходит в теле /apply, пустое — нет
const applyBody = (next) => {
  const wf = JSON.parse(readFileSync(fileURLToPath(new URL('../n8n/workflows/w9-robot.json', import.meta.url)), 'utf8'));
  const expr = wf.nodes.find((n) => n.name === 'Apply').parameters.body ?? wf.nodes.find((n) => n.name === 'Apply').parameters.jsonBody;
  const code = String(expr).replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const $ = () => ({ first: () => ({ json: { next } }) });
  return JSON.parse(new Function('$', `return ${code}`)($));
};

test('POST /apply: резюме в теле, когда оно есть', () => {
  const body = applyBody({ id: 7, external_id: '138000001', letter: 'Привет', resume: { hash: HB, title: 'Fullstack-разработчик' } });
  assert.equal(body.vacancyId, '138000001');
  assert.deepEqual(body.resume, { hash: HB, title: 'Fullstack-разработчик' });
  const without = applyBody({ id: 7, external_id: '138000001', letter: 'Привет', resume: null });
  assert.ok(!('resume' in without), 'без резюме поля нет — робот откликнется как раньше');
});

test('W5: 🚀 под письмом — только если резюме вакансии связано с hh; иначе подсказка', async () => {
  const settings = setup();
  const run = (resume_id) =>
    runNode('n8n/w5-letter/format-letter.js', {
      input: [{ id: 7, ok: true, mode: 'new', letter: 'Здравствуйте!' }],
      nodes: { Jobs: [{ id: 7 }], Vacancy: [vacancy({ resume_id })], Settings: settings },
    }).then(([out]) => out);
  assert.equal((await run('')).robot, true);
  assert.equal((await run('r3')).robot, true);
  const unlinked = await run('r2');
  assert.equal(unlinked.robot, false);
  assert.match(unlinked.text, /🤖 Робот не откликается: резюме «Дизайнер» не связано с резюме на hh/);
});

// Строка робота в сообщении с письмом (n8n/shared/robot.js → robotLine)
const robotLine = (() => {
  const code = ['time', 'card', 'robot'].map((f) => readFileSync(fileURLToPath(new URL(`../n8n/shared/${f}.js`, import.meta.url)), 'utf8')).join('\n');
  return new Function(`${code}\nreturn robotLine;`)();
})();

test('строка робота: резюме не связано с hh, скрытое резюме названо, обычное «скрыто» — как раньше', () => {
  const row = (extra) => ({ status: 'approved', ...extra });
  assert.match(robotLine(row({ apply_result: 'no_resume', apply_note: 'резюме «Дизайнер» не связано с резюме на hh' })), /^📄 Робот не откликается: резюме «Дизайнер» не связано с резюме на hh$/);
  assert.equal(robotLine(row({ apply_result: 'no_resume' })), '📄 Робот не откликается: резюме не связано с резюме на hh');
  assert.equal(
    robotLine(row({ apply_result: 'hidden', apply_note: 'резюме «Копия» скрыто от работодателей: открой его на hh и повтори' })),
    '🙈 резюме «Копия» скрыто от работодателей: открой его на hh и повтори — откликнитесь сами',
  );
  assert.equal(
    robotLine(row({ apply_result: 'hidden', apply_note: 'hh просит открыть резюме этому работодателю' })),
    '🙈 hh просит открыть резюме этому работодателю — откликнитесь сами',
    'прежний текст без дублей',
  );
  assert.equal(robotLine(row({ apply_result: 'hidden' })), '🙈 hh просит открыть резюме этому работодателю — откликнитесь сами');
});

// Каким резюме откликнется робот — видно в письме и на 🚀 (17.10.2026). resume_name пишет W1, пока резюме больше одного
test('W5: строка «📄 Отклик резюме» и подпись 🚀 с резюме; без названия — прежние', async () => {
  const run = (extra) =>
    runNode('n8n/w5-letter/format-letter.js', {
      input: [{ id: 7, ok: true, mode: 'new', letter: 'Здравствуйте!' }],
      nodes: { Jobs: [{ id: 7 }], Vacancy: [vacancy(extra)], Settings: setup() },
    }).then(([out]) => out);
  const named = await run({ resume_id: 'r3', resume_name: 'Fullstack' });
  assert.equal(named.robot, true);
  assert.equal(named.robot_button, '🚀 Роботом: Fullstack');
  assert.match(named.text, /\n📄 Отклик резюме «Fullstack»$/);
  const plain = await run({});
  assert.equal(plain.robot_button, '', 'одно резюме: кнопка с прежней подписью');
  assert.ok(!plain.text.includes('📄'));
});

test('🚀: основное не связано с hh, а другое связано — роботу нельзя (откликнулся бы резюме hh по умолчанию)', async () => {
  const settings = setup({
    resumes: [
      { id: 'r1', name: 'Frontend', active: true, hh: null },
      { id: 'r3', name: 'Fullstack', active: true, hh: { hash: HB, title: 'Fullstack-разработчик' } },
    ],
  });
  const out = await plan(vacancy({ resume_id: '' }), settings);
  assert.equal(out.ok, false);
  assert.equal(out.layout, 'manual');
  assert.match(out.text, /основное резюме «Frontend» не связано с резюме на hh, а робот откликнулся бы резюме hh по умолчанию/);
  // Gate снимает такую вакансию из очереди, вакансии связанного резюме уходят
  const queued = (id, resume_id) => vacancy({ id, resume_id, apply_state: 'queued', updatedAt: new Date().toISOString() });
  const g = await gate([queued(5, ''), queued(6, 'r3')], settings);
  assert.deepEqual(g.heal, [{ id: 5, to: '' }]);
  assert.equal(g.next.id, 6);
  // W5: без 🚀, с причиной
  const [letter] = await runNode('n8n/w5-letter/format-letter.js', {
    input: [{ id: 7, ok: true, mode: 'new', letter: 'Здравствуйте!' }],
    nodes: { Jobs: [{ id: 7 }], Vacancy: [vacancy()], Settings: settings },
  });
  assert.equal(letter.robot, false);
  assert.match(letter.text, /🤖 Робот не откликается: основное резюме «Frontend» не связано с резюме на hh/);
  // с hh не связано ни одно резюме — как раньше: роботом можно, резюме по умолчанию
  const none = setup({ resumes: [{ id: 'r1', name: 'Frontend', active: true, hh: null }, { id: 'r2', name: 'Дизайнер', active: true, hh: null }] });
  assert.equal((await plan(vacancy({ resume_id: '' }), none)).ok, true);
});

test('W9 Plan: ⛔ возвращает 🚀 с подписью резюме', async () => {
  const [out] = await runNode('n8n/w9-robot/plan.js', {
    input: [vacancy({ resume_id: 'r3', resume_name: 'Fullstack', apply_state: 'queued' })],
    nodes: { Job: { op: 'stop', id: 7, chatId: '1', messageId: 9, queryId: 'q' }, Settings: setup() },
  });
  assert.equal(out.save, 'unqueue');
  assert.equal(out.layout, 'robot');
  assert.equal(out.robot_button, '🚀 Роботом: Fullstack');
});

test('W9 Result: «🚀 Отправлено … резюме «…»» в письме, «📄 Резюме» в карточке; сбой — 🚀 с подписью', async () => {
  const row = vacancy({ resume_id: 'r3', resume_name: 'Fullstack', apply_state: 'applying', tg_message_id: 54, resume: { hash: HB, title: 'Fullstack-разработчик' } });
  const result = (body) =>
    runNode('n8n/w9-robot/result.js', { input: [{ statusCode: 200, body }], nodes: { Job: { chatId: '1' }, Gate: { next: row } } }).then(([out]) => out);
  const done = await result({ group: 'done', outcome: 'applied', letter: 'attached', resume: { hash: HB, title: 'Fullstack-разработчик', used: true } });
  assert.equal(done.layout, 'done');
  assert.match(done.text, /🚀 Отправлено \d\d\.\d\d \d\d:\d\d резюме «Fullstack» · ✉️ письмо приложено/);
  assert.ok(!done.text.includes('📄 Отклик резюме'));
  assert.match(done.card.text, /\n📄 Резюме: Fullstack\n/);
  const failed = await result({ group: 'error', outcome: 'error', note: 'нет кнопки' });
  assert.equal(failed.layout, 'robot');
  assert.equal(failed.robot_button, '🚀 Роботом: Fullstack');
  assert.match(failed.text, /\n📄 Отклик резюме «Fullstack»$/);
});

test('W3 Apply sent: «↩️ Отменить» возвращает 🚀 с подписью резюме', async () => {
  const [out] = await runNode('n8n/w3-telegram/apply-sent.js', {
    nodes: {
      Route: { op: 'unsent', chatId: '1', messageId: 55, queryId: 'q' },
      'Sent row': vacancy({ status: 'applied', apply_by: 'me', resume_name: 'Fullstack' }),
    },
  });
  assert.equal(out.robot, true);
  assert.equal(out.robot_button, '🚀 Роботом: Fullstack');
});

// Подпись 🚀 в собранных workflow: robot_button, пусто — прежняя подпись
test('сборка: подпись 🚀 из robot_button, без неё — «🚀 Откликнуться роботом»', () => {
  const button = (file, node) => {
    const wf = JSON.parse(readFileSync(fileURLToPath(new URL(`../n8n/workflows/${file}`, import.meta.url)), 'utf8'));
    const params = wf.nodes.find((n) => n.name === node).parameters;
    return params.inlineKeyboard?.rows?.[0]?.row?.buttons?.[0]?.text ?? params.replyMarkup?.inlineKeyboard?.rows?.[0]?.row?.buttons?.[0]?.text;
  };
  const evaluate = (expr, json) => {
    const code = String(expr).replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
    return new Function('$json', '$', `return ${code}`)(json, () => ({ first: () => ({ json }) }));
  };
  for (const [file, node] of [['w5-letter.json', 'Send letter: robot'], ['w9-robot.json', 'Letter: robot'], ['w3-telegram.json', 'Letter: restore robot']]) {
    const expr = button(file, node);
    assert.ok(expr, `${file} · ${node}: нет кнопки`);
    assert.equal(evaluate(expr, { robot_button: '🚀 Роботом: Fullstack' }), '🚀 Роботом: Fullstack', `${file} · ${node}`);
    assert.equal(evaluate(expr, { robot_button: '' }), '🚀 Откликнуться роботом', `${file} · ${node}`);
  }
});
