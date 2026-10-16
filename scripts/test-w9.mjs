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
    nodes: { Job: { op: 'tick', fromUser: false }, Settings: settings, Queue: queue, Today: [{}], Health: { ok: true, busy: false } },
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
