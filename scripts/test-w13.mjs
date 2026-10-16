// Сценарии W13 (рекомендации по резюме) с несколькими резюме, без n8n и Telegram: node --test scripts/test-w13.mjs
// Code-ноды W13 (Job, Plan, Hh, Parse, Step, Save rows) исполняются как тело async-функции, как в n8n, с общим static data
// между шагами; нейросеть и робот подменяются готовыми ответами.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNode } from './lib/sandbox.mjs';

const ENV = { TG_CHAT_ID: '1' };
const MAIN_TEXT = 'Frontend-разработчик\n\nReact, TypeScript, Next.js. Работал в Acme.';
const DESIGN_TEXT = 'UX/UI-дизайнер\n\nFigma, прототипы, дизайн-системы. Работал в Studio.';
const FACTS = { position: 'Frontend-разработчик', years: 5, city: 'Казань', formats: ['REMOTE'] };

const single = (extra = {}) => ({
  'profile.ready': true,
  'profile.resume': MAIN_TEXT,
  'profile.facts': FACTS,
  ...extra,
});
const duo = (extra = {}, r2 = {}) =>
  single({
    resumes: [
      { id: 'r1', name: 'Frontend', active: true, hh: null },
      { id: 'r2', name: 'Дизайнер', active: true, hh: null },
    ],
    'resume.r2': { resume: DESIGN_TEXT, facts: { position: 'UX/UI-дизайнер' }, in_name: ['дизайнер'] },
    ...extra,
    ...(Object.keys(r2).length && { 'resume.r2': { resume: DESIGN_TEXT, facts: { position: 'UX/UI-дизайнер' }, in_name: ['дизайнер'], ...r2 } }),
  });
// Разметка резюме: должность вынесена в метку, текст не меняется
const cvOf = (id, text, title, hh = null) => ({
  v: 1,
  places: [],
  resumes: [{ id, hh, template: text.replace(title, '⟦title⟧'), title, about: '', keySkills: ['Figma'] }],
});
const gemini = (answer) => ({ statusCode: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] } });

function world(initial) {
  const w = { state: {}, settings: { ...initial } };
  const rows = () => Object.entries(w.settings).map(([name, value]) => ({ name, value_json: JSON.stringify(value) }));
  const run = async (file, nodes, input = [{}]) => (await runNode(file, { nodes, input, state: w.state, env: ENV }))[0];
  // Одно событие: кнопка (data) или ответ на вопрос (op input) → Job → Plan → [Hh | Parse] → Step → Save rows.
  // vacancies — строки таблицы (читаются, только если Plan попросил), llm — ответ нейросети, robot — ответ робота
  w.send = async (input, { vacancies = [], llm, robot } = {}) => {
    const job = await run('n8n/w13-resume/job.js', {}, [{ chatId: '1', messageId: 77, ...input }]);
    const Settings = rows();
    const plan = await run('n8n/w13-resume/plan.js', { Job: job, Settings });
    const nodes = { Job: job, Plan: plan, Settings };
    if (plan.rows) nodes.Vacancies = vacancies;
    let hh = null;
    let parse = null;
    if (plan.route === 'file') return { job, plan, file: await run('n8n/w13-resume/resume-file.js', { Settings }) };
    // Запись на hh: тело запроса робота — в plan.writeBody; ответ робота тест не подставляет
    if (plan.route === 'write') return { job, plan };
    if (plan.route === 'robot' && robot !== undefined) {
      hh = await run('n8n/w13-resume/hh.js', {}, [robot]);
      nodes.Hh = hh;
    }
    let build = null;
    if (plan.route === 'llm' || (plan.route === 'robot' && hh?.next === 'llm')) {
      // «Build» как в n8n (запрос к нейросети), «Parse» — на готовом ответе llm. mode у раскладки с hh — пустой: split
      build = await run('n8n/w13-resume/build.js', { Plan: { ...plan, mode: plan.mode || 'split' }, Settings, ...(plan.rows && { Vacancies: vacancies }) });
      nodes.Build = build;
      parse = await run('n8n/w13-resume/parse.js', { Build: build, Plan: plan, Job: job, Settings }, [gemini(llm)]);
      nodes.Parse = parse;
    }
    const out = await run('n8n/w13-resume/step.js', nodes);
    let saved = null;
    if (out.save) {
      const written = await runNode('n8n/w13-resume/save-rows.js', { nodes: { Step: out, Settings }, input: [{}], state: w.state, env: ENV });
      saved = written.map((r) => r.name);
      for (const r of written) w.settings[r.name] = JSON.parse(r.value_json);
    }
    return { job, plan, hh, build, parse, out, saved };
  };
  w.press = (data, extra) => w.send({ data }, extra);
  w.say = (field, text, extra) => w.send({ op: 'input', field, text, userMessageId: 5, promptId: 6 }, extra);
  w.sid = () => w.state.session?.sid;
  return w;
}

test('one resume: root panel is the old one — no resume line, no switch, layout rs root', async () => {
  const w = world(single());
  const { out } = await w.press('rs:view');
  assert.equal(out.view.layout, 'rs root');
  assert.doesNotMatch(out.view.text, /📚|Другое резюме/);
  assert.match(out.view.text, /Рекомендации по резюме/);
  assert.equal(w.state.target ?? 'r1', 'r1');
});

test('several resumes: main is open first, the panel names it and offers a switch', async () => {
  const w = world(duo());
  const { out } = await w.press('rs:view');
  assert.equal(out.view.layout, 'rs rootm');
  assert.match(out.view.text, /📚 Резюме: <b>Frontend<\/b> · не связано с hh/);
  assert.match(out.view.text, /Другое резюме/);
});

test('rs:list → the picker marks the current resume; rs:r:r2 switches and shows the second resume', async () => {
  const w = world(duo());
  let { out } = await w.press('rs:list');
  assert.equal(out.view.layout, 'rs pick2');
  assert.equal(out.view.b.r0.cb, 'rs:r:r1');
  assert.equal(out.view.b.r1.cb, 'rs:r:r2');
  assert.match(out.view.b.r0.text, /^👉 Frontend/);
  assert.doesNotMatch(out.view.b.r1.text, /👉/);

  ({ out } = await w.press('rs:r:r2'));
  assert.equal(w.state.target, 'r2');
  assert.equal(out.view.layout, 'rs rootm0', 'a resume that is not linked to hh has no hh sections');
  assert.match(out.view.text, /📚 Резюме: <b>Дизайнер<\/b> · не связано с hh/);
  assert.match(out.view.text, new RegExp(`Резюме: ${DESIGN_TEXT.length} знак`), 'the length is of the second resume');
  assert.doesNotMatch(out.view.text, /💼|📤/);
  // rs:view (кнопка «⬅️ Рекомендации») остаётся на выбранном резюме
  ({ out } = await w.press('rs:view'));
  assert.match(out.view.text, /<b>Дизайнер<\/b>/);
});

test('a linked second resume gets the hh sections and the root with the switch', async () => {
  const w = world(duo({ resumes: [{ id: 'r1', name: 'Frontend', active: true, hh: null }, { id: 'r2', name: 'Дизайнер', active: true, hh: { hash: 'HASH2', title: 'Дизайнер на hh' } }] }));
  await w.press('rs:r:r2');
  const { out } = await w.press('rs:view');
  assert.equal(out.view.layout, 'rs rootm');
  assert.match(out.view.text, /связано с hh/);
  assert.match(out.view.text, /📤/);
});

test('a resume that does not exist is not selected', async () => {
  const w = world(duo());
  const { out } = await w.press('rs:r:r4');
  assert.equal(w.state.target ?? 'r1', 'r1');
  assert.match(out.view.text, /Такого резюме нет/);
  assert.match(out.view.text, /<b>Frontend<\/b>/);
});

test('the working resume is deleted: back to the main one, the started edit is dropped', async () => {
  const w = world(duo());
  await w.press('rs:r:r2');
  await w.say('upgrade', 'Добавь Sketch', { llm: { understood: 'x', places: [{ where: 'Навыки', action: 'add', what: 'добавлю Sketch' }], questions: [] } });
  assert.ok(w.state.session, 'the edit of the second resume has begun');
  delete w.settings['resume.r2'];
  w.settings.resumes = [{ id: 'r1', name: 'Frontend', active: true, hh: null }];
  const { out } = await w.press('rs:view');
  assert.equal(w.state.target, 'r1');
  assert.equal(w.state.session, null);
  assert.equal(out.view.layout, 'rs root');
  assert.match(out.view.text, /Frontend-разработчик|знаков/);
});

test('Upgrade of the second resume: patch lands in resume.r2, the version in resume.r2.history; the main resume is not touched', async () => {
  const w = world(duo());
  await w.press('rs:r:r2');
  let r = await w.press('rs:up');
  assert.ok(r.out.prompt, 'asks what to change');
  r = await w.say('upgrade', 'Добавь в навыки Sketch', {
    llm: { understood: 'добавить Sketch', places: [{ where: 'Навыки', action: 'add', what: 'добавлю Sketch' }], questions: [] },
  });
  assert.equal(r.plan.route, 'llm');
  assert.equal(r.out.view.layout, 'ru plan');
  r = await w.press(`ru:${w.sid()}:y`, {
    llm: { patches: [{ where: 'Навыки', old: 'Figma, прототипы, дизайн-системы.', new: 'Figma, Sketch, прототипы, дизайн-системы.', why: 'просьба' }] },
  });
  assert.equal(r.out.view.layout, 'rp add', 'the patch is searched in the text of the second resume');
  r = await w.press(`rp:${w.sid()}:0:y`);
  assert.match(r.out.view.text, /Резюме обновлено/);
  assert.deepEqual([...r.saved].sort(), ['resume.r2', 'resume.r2.history']);

  assert.match(w.settings['resume.r2'].resume, /Figma, Sketch, прототипы/);
  assert.deepEqual(w.settings['resume.r2'].facts, { position: 'UX/UI-дизайнер' }, 'the other fields of the resume are kept');
  assert.deepEqual(w.settings['resume.r2'].in_name, ['дизайнер']);
  assert.equal(w.settings['resume.r2.history'].length, 1);
  assert.equal(w.settings['resume.r2.history'][0].resume, DESIGN_TEXT);
  assert.equal(w.settings['resume.r2.history'][0].by, 'upgrade');
  assert.equal(w.settings['profile.resume'], MAIN_TEXT, 'the main resume text is the same');
  assert.equal(w.settings['resume.history'], undefined, 'the main history is not written');
});

test('undo of the second resume swaps the text with the last version, in its own keys', async () => {
  const hist = [{ at: '2026-10-16T10:00:00.000Z', by: 'upgrade', note: 'x', resume: 'Старый текст дизайнера', extra: '' }];
  const w = world(duo({ 'resume.r2.history': hist }));
  await w.press('rs:r:r2');
  let r = await w.press('rs:undo');
  assert.equal(r.out.view.layout, 'rs undo');
  r = await w.press('rs:undo:y');
  assert.match(r.out.view.text, /Откатил/);
  assert.equal(w.settings['resume.r2'].resume, 'Старый текст дизайнера');
  assert.equal(w.settings['resume.r2.history'][0].resume, DESIGN_TEXT, 'the current version went to the history');
  assert.equal(w.settings['resume.history'], undefined);
  assert.equal(w.settings['profile.resume'], MAIN_TEXT);
});

test('the main resume still saves to the global keys', async () => {
  const w = world(duo());
  await w.press('rs:up');
  await w.say('upgrade', 'Добавь Vue', { llm: { understood: 'x', places: [{ where: 'Навыки', action: 'add', what: 'добавлю Vue' }], questions: [] } });
  await w.press(`ru:${w.sid()}:y`, { llm: { patches: [{ where: 'Навыки', old: 'React, TypeScript, Next.js.', new: 'React, TypeScript, Next.js, Vue.', why: 'просьба' }] } });
  const r = await w.press(`rp:${w.sid()}:0:y`);
  assert.deepEqual([...r.saved].sort(), ['profile.resume', 'resume.history']);
  assert.match(w.settings['profile.resume'], /Next\.js, Vue/);
  assert.equal(w.settings['resume.r2'].resume, DESIGN_TEXT);
});

test('skill coverage counts the vacancies of the chosen resume only', async () => {
  const w = world(duo());
  const vacancies = [
    { id: 1, key_skills: 'React, TypeScript', status: 'waiting', resume_id: '' },
    { id: 2, key_skills: 'React, TypeScript', status: 'waiting' },
    { id: 3, key_skills: 'Figma, Sketch', status: 'waiting', resume_id: 'r2' },
    { id: 4, key_skills: 'Figma, Sketch', status: 'waiting', resume_id: 'r2' },
    { id: 5, key_skills: 'Figma, Sketch', status: 'waiting', resume_id: 'r2' },
    { id: 6, key_skills: 'React, TypeScript', status: 'waiting', resume_id: 'r9' },
  ];
  let { out } = await w.press('rs:view', { vacancies });
  assert.match(out.view.text, /по 3 вакансиям/, 'main: two without a resume and one of a deleted resume');
  assert.match(out.view.text, /100%/);
  ({ out } = await w.press('rs:r:r2', { vacancies }));
  assert.match(out.view.text, /по 3 вакансиям/);
  assert.match(out.view.text, /50%/, 'Figma is in the text, Sketch is not');
  assert.match(out.view.text, /Sketch/);
});

test('one resume: all vacancies are counted, whatever resume_id they carry', async () => {
  const w = world(single());
  const vacancies = [
    { id: 1, key_skills: 'React', status: 'waiting' },
    { id: 2, key_skills: 'React', status: 'waiting', resume_id: 'r2' },
  ];
  const { out } = await w.press('rs:view', { vacancies });
  assert.match(out.view.text, /по 2 вакансиям/);
});

test('hh sections: the main resume reads the default hh resume, a linked one — its own, an unlinked second one — none', async () => {
  const w = world(duo({ resumes: [{ id: 'r1', name: 'Frontend', active: true, hh: null }, { id: 'r2', name: 'Дизайнер', active: true, hh: null }] }));
  let r = await w.press('rc:go');
  assert.equal(r.plan.route, 'robot');
  assert.equal(r.plan.hhHash, '');

  await w.press('rs:r:r2');
  r = await w.press('rc:go', { llm: { title: 'UX/UI-дизайнер', about: { from: '', to: '' }, places: [] } });
  assert.equal(r.plan.route, 'llm', 'no robot: there is no hh resume to read');
  assert.equal(r.plan.mode, 'split');
  assert.ok(!w.state.session.hhHash, 'the session did not ask hh');
});

test('hh sections: a linked second resume reads it by hash', async () => {
  const w = world(duo({ resumes: [{ id: 'r1', name: 'Frontend', active: true, hh: null }, { id: 'r2', name: 'Дизайнер', active: true, hh: { hash: 'HASH2', title: 'Дизайнер на hh' } }] }));
  await w.press('rs:r:r2');
  const r = await w.press('rc:go');
  assert.equal(r.plan.route, 'robot');
  assert.equal(r.plan.hhHash, 'HASH2');
  assert.equal(w.state.session.hhHash, 'HASH2');
  assert.equal(w.state.session.target, 'r2');
});

test('hh answer with another resume than asked is refused, the same hash goes on', async () => {
  const resumes = [{ id: 'r1', name: 'Frontend', active: true, hh: null }, { id: 'r2', name: 'Дизайнер', active: true, hh: { hash: 'HASH2', title: 'Дизайнер на hh' } }];
  const answer = (hash) => ({ statusCode: 200, body: { ok: true, resume: { hash, title: 'Дизайнер', about: '', keySkills: [], places: [] } } });
  let w = world(duo({ resumes }));
  await w.press('rs:r:r2');
  let r = await w.press('rc:go', { robot: answer('OTHER') });
  assert.equal(r.hh.next, 'step');
  assert.equal(r.hh.error, 'not_found');
  assert.match(r.out.view.text, /Резюме на hh не прочитал/);
  assert.equal(r.out.view.layout, 'rc retry');

  w = world(duo({ resumes }));
  await w.press('rs:r:r2');
  r = await w.press('rc:go', { robot: answer('HASH2'), llm: { title: 'UX/UI-дизайнер', about: { from: '', to: '' }, places: [] } });
  assert.equal(r.hh.next, 'llm');
  assert.equal(w.state.session.hh.hash, 'HASH2');
});

test('sections of an unlinked second resume: laid out from the bot text, saved in resume.r2.cv with its own id', async () => {
  const w = world(duo());
  await w.press('rs:r:r2');
  let r = await w.press('rc:go', { llm: { title: 'UX/UI-дизайнер', about: { from: '', to: '' }, places: [] } });
  assert.equal(r.parse.ok, true);
  assert.equal(r.parse.cv.resumes[0].id, 'r2');
  assert.equal(r.out.view.layout, 'rk skills8', 'no hh to compare: straight to the key skills');
  r = await w.press(`rk:${w.sid()}:d`);
  assert.deepEqual(r.saved, ['resume.r2.cv']);
  assert.equal(w.settings['resume.r2.cv'].resumes[0].id, 'r2');
  assert.equal(w.settings['resume.r2.cv'].resumes[0].hh, null);
  assert.equal(w.settings.cv, undefined, 'the main markup is not written');
});

test('export of a linked second resume: reads and writes its hash', async () => {
  const hh = { hash: 'HASH2', title: 'Дизайнер на hh' };
  const w = world(
    duo(
      { resumes: [{ id: 'r1', name: 'Frontend', active: true, hh: null }, { id: 'r2', name: 'Дизайнер', active: true, hh }], 'resume.r2.cv': cvOf('r2', DESIGN_TEXT, 'UX/UI-дизайнер', hh) },
    ),
  );
  await w.press('rs:r:r2');
  const robot = { statusCode: 200, body: { ok: true, resumeLive: false, resume: { hash: 'HASH2', title: 'Дизайнер', about: '', keySkills: ['Figma'], places: [] } } };
  let r = await w.press('re:go', { robot });
  assert.equal(r.plan.route, 'robot');
  assert.equal(r.plan.hhHash, 'HASH2');
  assert.equal(r.out.view.layout, 're item', 'the title differs from hh');
  r = await w.press(`re:${w.sid()}:0:p`);
  assert.equal(r.out.view.layout, 're sumdry');
  r = await w.press(`re:${w.sid()}:dry`);
  assert.equal(r.plan.route, 'write');
  assert.equal(r.plan.writeBody.hash, 'HASH2');
  assert.deepEqual(r.plan.writeBody.changes, [{ kind: 'title', value: 'UX/UI-дизайнер' }]);
  assert.equal(r.plan.writeBody.dry, true);
});

test('export of a second resume that is not linked to hh: refused with a hint, no robot', async () => {
  const w = world(duo({ 'resume.r2.cv': cvOf('r2', DESIGN_TEXT, 'UX/UI-дизайнер') }));
  await w.press('rs:r:r2');
  const r = await w.press('re:go');
  assert.equal(r.plan.route, 'step');
  assert.equal(w.state.session, null);
  assert.match(r.out.view.text, /не связано с резюме на hh/);
});

test('a session of one resume is not live for the other one', async () => {
  const w = world(duo());
  await w.press('rs:r:r2');
  await w.say('upgrade', 'Добавь Sketch', { llm: { understood: 'x', places: [{ where: 'Навыки', action: 'add', what: 'добавлю Sketch' }], questions: [] } });
  const sid = w.sid();
  assert.equal(w.state.session.target, 'r2');
  // выбрали другое резюме — старая сессия закрыта, её кнопки устарели
  await w.press('rs:r:r1');
  assert.equal(w.state.session, null);
  const r = await w.press(`ru:${sid}:y`);
  assert.match(r.out.view.text, /устарели/);
});

test('resume file of the second resume: its text and its name in the caption', async () => {
  const w = world(duo());
  await w.press('rs:r:r2');
  const { file } = await w.press('rs:file');
  assert.equal(file.text, DESIGN_TEXT);
  assert.match(file.caption, /«Дизайнер»/);
  const w1 = world(duo());
  const main = (await w1.press('rs:file')).file;
  assert.equal(main.text, MAIN_TEXT);
  assert.match(main.caption, /«Frontend»/);
  const one = (await world(single()).press('rs:file')).file;
  assert.doesNotMatch(one.caption, /«/, 'one resume: the caption is the old one');
});

test('a second resume without text says where to put it', async () => {
  const w = world(duo({}, { resume: '' }));
  await w.press('rs:r:r2');
  const { out } = await w.press('rs:view');
  assert.equal(out.view.layout, 'rs back');
  assert.match(out.view.text, /нет текста/);
  assert.equal(out.view.b.back.cb, 'rm:list');
});

test('analysis of the second resume: the prompt carries its text, its facts and the skills of its vacancies', async () => {
  const w = world(duo());
  await w.press('rs:r:r2');
  const vacancies = [
    { id: 1, key_skills: 'React, TypeScript', status: 'waiting', resume_id: '', title: 'React-разработчик' },
    { id: 3, key_skills: 'Figma, Sketch', status: 'waiting', resume_id: 'r2', title: 'Продуктовый дизайнер' },
    { id: 4, key_skills: 'Figma, Sketch', status: 'waiting', resume_id: 'r2', title: 'UX/UI-дизайнер' },
  ];
  const r = await w.press('rs:an', { vacancies, llm: { summary: ['нет цифр'], questions: [] } });
  const prompt = r.build.body.contents[0].parts[0].text;
  assert.match(prompt, /Figma, прототипы, дизайн-системы/);
  assert.doesNotMatch(prompt, /React, TypeScript, Next\.js/, 'the main resume text is not in the prompt');
  assert.match(prompt, /Кандидат: UX\/UI-дизайнер/, 'facts of the second resume');
  assert.match(prompt, /Figma 2 есть; Sketch 2 нет/);
  assert.doesNotMatch(prompt, /React 1/, 'vacancies of the main resume are not counted');
  assert.match(prompt, /продуктовый 1/, 'words of the titles — of its vacancies');
  assert.doesNotMatch(prompt, /react/i);
});

test('Upgrade prompt of the second resume carries the second resume', async () => {
  const w = world(duo());
  await w.press('rs:r:r2');
  const r = await w.say('upgrade', 'Добавь Sketch', { llm: { understood: 'x', places: [{ where: 'Навыки', action: 'add', what: 'добавлю Sketch' }], questions: [] } });
  const prompt = r.build.body.contents[0].parts[0].text;
  assert.match(prompt, /<resume>\nUX\/UI-дизайнер/);
  assert.doesNotMatch(prompt, /Next\.js/);
});

test('every patch dropped: a note and the plan frozen, not a crash (moveOn read the session after it was cleared)', async () => {
  const w = world(single());
  await w.press('rs:up');
  await w.say('upgrade', 'Добавь Vue', { llm: { understood: 'x', places: [{ where: 'Навыки', action: 'add', what: 'добавлю Vue' }], questions: [] } });
  const r = await w.press(`ru:${w.sid()}:y`, { llm: { patches: [{ where: 'Навыки', old: 'такого куска в резюме нет', new: 'x', why: 'просьба' }] } });
  assert.equal(r.out.view.layout, 'rs back');
  assert.match(r.out.view.text, /ни одну не смог привязать/);
  assert.equal(w.state.session, null);
  assert.ok(r.out.freeze, 'the plan stays in the chat without buttons');
});
