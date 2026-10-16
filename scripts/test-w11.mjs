// Сценарии W11 (резюме: список, карточка, создание, копия, удаление) без n8n и Telegram:
// запуск — node --test scripts/test-w11.mjs
// Code-ноды W11 (Plan, PDF text, Step) исполняются как тело async-функции, как в n8n, с общим static data между шагами.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readCode } from './lib/code.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = new Map();
const compile = (file) => {
  if (!compiled.has(file)) {
    const code = readCode(join(root, file));
    compiled.set(file, new Function('$', '$input', '$getWorkflowStaticData', '$env', `return (async () => {\n${code}\n})();`));
  }
  return compiled.get(file);
};
const accessor = (items) => ({ all: () => items, first: () => items[0] });

// Мир одного шага: static data живёт между шагами, настройки — как в таблице settings
function world(initial = {}) {
  const w = { state: {}, settings: { ...initial } };
  w.rows = () => Object.entries(w.settings).map(([name, value]) => ({ json: { name, value_json: JSON.stringify(value) } }));
  w.run = async (file, { job, plan, nodes = {}, input = {} }) => {
    const data = {
      Job: [{ json: job }],
      Plan: [{ json: plan ?? { route: 'step' } }],
      Settings: w.rows(),
      ...Object.fromEntries(Object.entries(nodes).map(([k, v]) => [k, [{ json: v }]])),
    };
    const $ = (name) => {
      if (!data[name]) throw new Error(`нет данных для ${name}`);
      return accessor(data[name]);
    };
    const out = await compile(file)($, accessor([{ json: input }]), () => w.state, {});
    return out[0]?.json;
  };
  const jobOf = (fields) => ({
    op: 'view', field: '', value: '', text: '', file: null, chatId: '1', queryId: '', messageId: 77, userMessageId: 0, promptId: 0, username: 'ivan', ...fields,
  });
  // Шаг W11 без нейросети: Job → Plan → (маршрут step) → Step; save применяется к настройкам, как «Save profile»
  w.step = async (fields, extra = {}) => {
    const job = jobOf(fields);
    const plan = await w.run('n8n/w11-profile/plan.js', { job });
    const out = await w.run('n8n/w11-profile/step.js', { job, plan, ...extra });
    w.save(out);
    return out;
  };
  w.save = (out) => {
    for (const [name, value] of Object.entries(out?.save ?? {})) w.settings[name] = value;
  };
  w.jobOf = jobOf;
  return w;
}

const RESUME = 'Дизайнер интерфейсов. Figma, прототипы, дизайн-системы, исследования пользователей. '.repeat(8);
const FACTS = {
  name: 'Иван Петров', first_name: 'Иван', name_gen: 'Ивана', gender: 'm', position: 'Frontend-разработчик', position_gen: 'фронтендера',
  level: 'senior', years: 5, skills: ['React'], companies: ['Acme'], english: 'B2', city: 'Казань', country: 'Россия',
  country_gen: 'России', citizenship: 'РФ', formats: ['REMOTE'], relocation: false, salary: null, education: 'higher',
  contacts: { telegram: '@ivan', email: '' },
};
const main = (extra = {}) => ({
  'profile.ready': true,
  'profile.preset': 'frontend',
  'profile.resume': 'Frontend, React, 5 лет. '.repeat(30),
  'profile.facts': FACTS,
  'profile.signature': 'Иван',
  'profile.contact': 'tg: @ivan',
  'profile.tz': 'Europe/Moscow',
  ...extra,
});
// Ответ нейросети на резюме дизайнера (то, что вернул бы «Parse profile»)
const designerAnswer = {
  facts: { name: '', first_name: '', gender: 'unknown', position: 'UX/UI-дизайнер', position_gen: 'дизайнера интерфейсов', level: 'middle', years: 4, skills: ['Figma'], companies: ['Studio'], english: '', city: '', country: '', formats: ['REMOTE'] },
  about: ['UX/UI-дизайнер, 4 года'],
  search: { roles: ['34'], in_name: ['дизайнер интерфейсов', 'UX/UI дизайнер', 'product designer'], anywhere: [], stop_words: ['графический'] },
  rules: { skip: ['не дизайн интерфейсов'], maybe: [], apply: ['Figma и дизайн-системы'], ignore: [] },
};
// «Parse profile» как его делает n8n/w11-profile/parse-profile.js: черновик + факты о человеке из основного резюме
async function parseDraft(w, plan) {
  const profile = await loadProfile();
  const draft = profile.draftFromAnswer(designerAnswer, {});
  if (plan.inherit) draft.facts = profile.inheritPerson(draft.facts, plan.inherit);
  return { ok: true, draft };
}
let profileLib;
async function loadProfile() {
  if (!profileLib) {
    const files = ['time', 'card', 'settings', 'hh-roles', 'search', 'resumes', 'profile'].map((f) => readCode(join(root, `n8n/shared/${f}.js`)));
    profileLib = new Function(`${files.join('\n')}\nreturn { draftFromAnswer, inheritPerson };`)();
  }
  return profileLib;
}

const listOf = (w) => w.settings.resumes;

test('rm:list with one resume: list1, main row', async () => {
  const w = world(main());
  const out = await w.step({ op: 'rm', field: 'list' });
  assert.equal(out.view.layout, 'rm list1');
  assert.match(out.view.text, /Резюме<\/b> \(1 из 5\)/);
  assert.match(out.view.text, /Frontend-разработчик|основное/);
  assert.equal(out.view.b.r0.cb, 'rm:o:r1');
  assert.equal(out.view.b.t0.cb, 'rm:off:r1:l');
  assert.equal(out.save, null);
});

test('rm before onboarding: asks for the main resume', async () => {
  const w = world({});
  const out = await w.step({ op: 'rm', field: 'list' });
  assert.equal(out.view.layout, 'pf plain');
  assert.match(out.view.text, /основного|основное/);
});

test('create from pasted text: wait → text → review → save → card; shared settings untouched', async () => {
  const w = world(main());
  // ➕ Новое резюме
  let out = await w.step({ op: 'rm', field: 'new' });
  assert.equal(out.view.layout, 'rm wait');
  assert.match(out.prompt, /Новое резюме/);
  assert.ok(w.state.await?.kind === 'create');
  // ответ текстом: Plan отправляет к нейросети как create
  const textJob = w.jobOf({ op: 'input', field: 'newresume', text: RESUME, messageId: 0, userMessageId: 5, promptId: 6 });
  const plan = await w.run('n8n/w11-profile/plan.js', { job: textJob });
  assert.equal(plan.route, 'llm');
  assert.equal(plan.create, true);
  assert.equal(plan.mode, 'extract');
  assert.equal(plan.inherit.gender, 'm');
  assert.ok(w.state.text.length > 400);
  // разбор нейросети → Step: обзор «Сохранить?»
  const parsed = await parseDraft(w, plan);
  assert.equal(parsed.draft.facts.gender, 'm', 'gender is inherited from the main resume');
  assert.equal(parsed.draft.facts.name, 'Иван Петров');
  out = await w.run('n8n/w11-profile/step.js', { job: textJob, plan, nodes: { 'Parse profile': parsed, 'Build extract': { mode: 'extract' } } });
  assert.equal(out.view.layout, 'pf review');
  assert.match(out.view.text, /Новое резюме разобрано/);
  assert.equal(out.save, null, 'nothing is saved before confirmation');
  assert.deepEqual(out.deleteIds, [5, 6], 'question and pasted text are removed from the chat');
  assert.equal(w.state.mode, 'create');
  // ✅ Сохранить
  out = await w.step({ op: 'confirm', value: 'yes' });
  assert.equal(out.view.layout, 'rm card');
  assert.match(out.view.text, /Резюме создано/);
  assert.deepEqual(listOf(w).map((r) => [r.id, r.active]), [['r1', true], ['r2', true]]);
  assert.equal(listOf(w)[1].name, 'UX/UI-дизайнер');
  const data = w.settings['resume.r2'];
  assert.equal(data.resume, RESUME.trim());
  assert.equal(data.preset, 'generic');
  assert.deepEqual(data.roles, ['34']);
  assert.deepEqual(data.stop_words, ['графический']);
  assert.equal(data.facts.gender, 'm');
  for (const shared of ['profile.signature', 'profile.contact', 'profile.tz', 'profile.preset']) {
    assert.equal(w.settings[shared], main()[shared], `${shared} unchanged`);
  }
  assert.equal(w.settings['profile.resume'], main()['profile.resume'], 'main resume text unchanged');
  assert.equal(w.state.target, 'r2');
  assert.equal(w.state.draft, undefined, 'draft is cleared');
  assert.equal(out.collect, false);
});

test('create from text shorter than 400 chars: problem, message kept', async () => {
  const w = world(main());
  await w.step({ op: 'rm', field: 'new' });
  const job = w.jobOf({ op: 'input', field: 'newresume', text: 'коротко', messageId: 0, userMessageId: 5, promptId: 6 });
  const plan = await w.run('n8n/w11-profile/plan.js', { job });
  assert.equal(plan.route, 'step');
  assert.match(plan.problem, /400/);
  const out = await w.run('n8n/w11-profile/step.js', { job, plan });
  assert.equal(out.view.layout, 'pf plain');
  assert.deepEqual(out.deleteIds, [], 'the text is not deleted when it did not reach the model');
});

test('PDF after ➕ goes straight to the model as a new resume; without ➕ it asks', async () => {
  const w = world(main());
  await w.step({ op: 'rm', field: 'new' });
  const pdfJob = w.jobOf({ op: 'pdf', file: { id: 'f', name: 'cv.pdf', size: 1000 }, messageId: 0 });
  let pdf = await w.run('n8n/w11-profile/pdf-text.js', { job: pdfJob, input: { text: RESUME } });
  assert.equal(pdf.toLlm, true);
  assert.equal(pdf.create, true);
  assert.equal(pdf.inherit.city, 'Казань');
  assert.equal(w.state.await, undefined, 'the flag is spent');
  // второй PDF без ➕: меню выбора
  pdf = await w.run('n8n/w11-profile/pdf-text.js', { job: pdfJob, input: { text: RESUME } });
  assert.equal(pdf.toLlm, false);
  assert.equal(pdf.replace, true);
  const out = await w.run('n8n/w11-profile/step.js', { job: pdfJob, nodes: { 'PDF text': pdf } });
  assert.equal(out.view.layout, 'pf replace text', 'frontend preset');
  assert.match(out.view.text, /Как новое резюме/);
});

test('PDF after ➕: the wait panel and the question are cleaned up, the flag is spent', async () => {
  const w = world(main());
  let out = await w.step({ op: 'rm', field: 'new', messageId: 55 });
  assert.equal(out.awaitPrompt, true);
  assert.equal(w.state.await.panel, 55);
  w.state.promptId = 66; // «Remember prompt» запомнил вопрос
  const pdfJob = w.jobOf({ op: 'pdf', file: { id: 'f', name: 'cv.pdf', size: 1000 }, messageId: 0 });
  const pdf = await w.run('n8n/w11-profile/pdf-text.js', { job: pdfJob, input: { text: RESUME } });
  assert.deepEqual(w.state.cleanup, { panel: 55, prompt: 66 });
  assert.equal(w.state.promptId, undefined);
  const plan = { route: 'pdf' };
  const parsed = await parseDraft(w, pdf);
  out = await w.run('n8n/w11-profile/step.js', { job: pdfJob, plan, nodes: { 'PDF text': pdf, 'Parse profile': parsed, 'Build extract': { mode: 'extract' } } });
  assert.deepEqual(out.deleteIds.sort(), [55, 66]);
  assert.equal(w.state.cleanup, undefined);
  assert.equal(out.view.layout, 'pf review');
});

test('leaving the wait panel removes the question and the flag; a second ➕ replaces the question', async () => {
  const w = world(main());
  await w.step({ op: 'rm', field: 'new', messageId: 55 });
  w.state.promptId = 66;
  let out = await w.step({ op: 'rm', field: 'list', messageId: 55 });
  assert.deepEqual(out.deleteIds, [66]);
  assert.equal(w.state.await, undefined);
  assert.equal(w.state.promptId, undefined);
  await w.step({ op: 'rm', field: 'new', messageId: 55 });
  w.state.promptId = 77;
  out = await w.step({ op: 'rm', field: 'new', messageId: 55 });
  assert.deepEqual(out.deleteIds, [77], 'the old question is removed when a new one is asked');
});

test('new text for a resume: the wait panel is removed once the PDF arrives', async () => {
  const w = await withSecond();
  await w.step({ op: 'rm', field: 'txt', value: 'r2', messageId: 55 });
  const pdfJob = w.jobOf({ op: 'pdf', file: { id: 'f', name: 'cv.pdf', size: 1000 }, messageId: 0 });
  const pdf = await w.run('n8n/w11-profile/pdf-text.js', { job: pdfJob, input: { text: RESUME } });
  const out = await w.run('n8n/w11-profile/step.js', { job: pdfJob, nodes: { 'PDF text': pdf } });
  assert.deepEqual(out.deleteIds, [55]);
});

test('expired ➕ flag is ignored', async () => {
  const w = world(main());
  w.state.await = { kind: 'create', at: Date.now() - 31 * 60 * 1000 };
  const pdf = await w.run('n8n/w11-profile/pdf-text.js', {
    job: w.jobOf({ op: 'pdf', file: { id: 'f', name: 'cv.pdf', size: 1000 } }),
    input: { text: RESUME },
  });
  assert.equal(pdf.toLlm, false);
  assert.equal(pdf.replace, true);
});

test('PDF as new resume via pf:new:add', async () => {
  const w = world(main());
  const pdfJob = w.jobOf({ op: 'pdf', file: { id: 'f', name: 'cv.pdf', size: 1000 }, messageId: 0 });
  await w.run('n8n/w11-profile/pdf-text.js', { job: pdfJob, input: { text: RESUME } });
  const job = w.jobOf({ op: 'replace', value: 'add' });
  const plan = await w.run('n8n/w11-profile/plan.js', { job });
  assert.equal(plan.route, 'llm');
  assert.equal(plan.create, true);
  assert.equal(w.state.text, RESUME.trim());
});

test('limit of 5 resumes', async () => {
  const list = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => ({ id, name: `R ${id}`, active: true, hh: null }));
  const w = world(main({ resumes: list }));
  const out = await w.step({ op: 'rm', field: 'new' });
  assert.equal(out.view.layout, 'rm list5');
  assert.match(out.view.text, /предел/);
  assert.equal(w.state.await, undefined);
  const job = w.jobOf({ op: 'input', field: 'newresume', text: RESUME });
  const plan = await w.run('n8n/w11-profile/plan.js', { job });
  assert.equal(plan.route, 'step');
  assert.match(plan.problem, /предел/);
});

async function withSecond(extra = {}) {
  const w = world(
    main({
      resumes: [
        { id: 'r1', name: 'Frontend', active: true, hh: null },
        { id: 'r2', name: 'Дизайнер', active: true, hh: null },
      ],
      'resume.r2': { resume: RESUME, preset: 'generic', roles: ['34'], in_name: ['дизайнер'], extra: 'мои проекты', facts: { position: 'Дизайнер', years: 4 }, ...extra },
    }),
  );
  return w;
}

test('card of the second resume and ⚙️ → 👤 resets the target', async () => {
  const w = await withSecond();
  let out = await w.step({ op: 'rm', field: 'o', value: 'r2' });
  assert.equal(out.view.layout, 'rm card');
  assert.match(out.view.text, /Дизайнер<\/b> · 🟢 поиск включён/);
  assert.match(out.view.text, /дополнительно: 11 знаков/);
  assert.equal(out.view.b.toggle.cb, 'rm:off:r2');
  assert.equal(w.state.target, 'r2');
  out = await w.step({ op: 'view' });
  assert.equal(out.view.layout, 'pf profile');
  assert.equal(w.state.target, undefined);
  out = await w.step({ op: 'rm', field: 'o', value: 'r1' });
  assert.equal(out.view.layout, 'pf profile', 'the main resume opens the usual profile panel');
});

test('toggle: off, on, and the last active resume cannot be switched off', async () => {
  const w = await withSecond();
  await w.step({ op: 'rm', field: 'o', value: 'r2' });
  let out = await w.step({ op: 'rm', field: 'off', value: 'r2' });
  assert.equal(listOf(w)[1].active, false);
  assert.match(out.view.text, /⏸ поиск выключен/);
  // r1 — единственное включённое
  out = await w.step({ op: 'rm', field: 'off', value: 'r1:l' });
  assert.equal(listOf(w)[0].active, true);
  assert.equal(out.view.layout, 'rm list2');
  assert.match(out.view.text, /хотя бы одно включённое/);
  out = await w.step({ op: 'rm', field: 'on', value: 'r2:l' });
  assert.equal(listOf(w)[1].active, true);
  assert.equal(out.view.layout, 'rm list2');
  // теперь r1 можно выключить
  await w.step({ op: 'rm', field: 'off', value: 'r1:l' });
  assert.equal(listOf(w)[0].active, false);
});

test('rename', async () => {
  const w = await withSecond();
  await w.step({ op: 'rm', field: 'o', value: 'r2' });
  let out = await w.step({ op: 'rm', field: 'ren', value: 'r2' });
  assert.match(out.prompt, /Название резюме/);
  out = await w.step({ op: 'input', field: 'rname', text: '  UX дизайнер ', messageId: 0, userMessageId: 5, promptId: 6 });
  assert.equal(listOf(w)[1].name, 'UX дизайнер');
  assert.equal(out.view.layout, 'rm card');
  // повтор названия получает номер
  await w.step({ op: 'input', field: 'rname', text: 'Frontend', messageId: 0 });
  assert.equal(listOf(w)[1].name, 'Frontend 2');
});

test('clone: inactive copy with the same data; main can be cloned too', async () => {
  const w = await withSecond();
  let out = await w.step({ op: 'rm', field: 'clone', value: 'r2' });
  assert.equal(listOf(w).length, 3);
  const copy = listOf(w)[2];
  assert.equal(copy.id, 'r3');
  assert.equal(copy.active, false);
  assert.equal(copy.name, 'Дизайнер (копия)');
  assert.deepEqual(w.settings['resume.r3'].in_name, ['дизайнер']);
  assert.equal(w.settings['resume.r3'].extra, 'мои проекты');
  assert.equal(out.view.layout, 'rm card');
  assert.equal(w.state.target, 'r3');
  out = await w.step({ op: 'rm', field: 'clone', value: 'r1' });
  assert.equal(w.settings['resume.r4'].preset, 'frontend', 'a clone of the main resume keeps its preset');
  assert.equal(w.settings['resume.r4'].resume, main()['profile.resume']);
  assert.equal(listOf(w)[3].name, 'Frontend (копия)');
});

test('delete asks first; the main resume cannot be deleted', async () => {
  const w = await withSecond();
  let out = await w.step({ op: 'rm', field: 'del', value: 'r2' });
  assert.equal(out.view.layout, 'rm delete');
  assert.equal(out.view.b.yes, 'rm:del:r2:y');
  assert.equal(listOf(w).length, 2, 'not deleted yet');
  out = await w.step({ op: 'rm', field: 'del', value: 'r2:y' });
  assert.equal(listOf(w).length, 1);
  assert.equal(w.settings['resume.r2'], null);
  assert.equal(out.view.layout, 'rm list1');
  out = await w.step({ op: 'rm', field: 'del', value: 'r1:y' });
  assert.equal(listOf(w).length, 1);
  assert.match(out.view.text, /нельзя/);
});

test('deleting the only active resume besides a switched-off main re-enables the main one', async () => {
  const w = await withSecond();
  await w.step({ op: 'rm', field: 'off', value: 'r1:l' });
  assert.equal(listOf(w)[0].active, false);
  await w.step({ op: 'rm', field: 'del', value: 'r2:y' });
  assert.equal(listOf(w).length, 1);
  assert.equal(listOf(w)[0].active, true);
});

test('«➕ Дополнить» and «Образцы писем» of the second resume go to resume.r2', async () => {
  const w = await withSecond();
  await w.step({ op: 'rm', field: 'o', value: 'r2' });
  let out = await w.step({ op: 'ask', field: 'extra' });
  assert.match(out.prompt, /дополнительно|Дополнительно/);
  assert.match(out.prompt, /Сейчас: 11 знаков/, 'shows the second resume, not the main one');
  out = await w.step({ op: 'input', field: 'extra', text: 'ещё проект', messageId: 0 });
  assert.equal(w.settings['resume.r2'].extra, 'ещё проект');
  assert.equal(w.settings['profile.extra'], undefined, 'main extra untouched');
  assert.equal(out.view.layout, 'rm card');
  await w.step({ op: 'input', field: 'examples', text: 'Здравствуйте! Пример', messageId: 0 });
  assert.equal(w.settings['resume.r2'].examples, 'Здравствуйте! Пример');
  assert.equal(w.settings['letters.examples'], undefined);
  // подпись — общая, в карточке не правится: сохраняется как раньше
  await w.step({ op: 'input', field: 'signature', text: 'Ваня', messageId: 0 });
  assert.equal(w.settings['profile.signature'], 'Ваня');
});

test('revise the second resume: draft from its own settings, saved into resume.r2 with extras kept', async () => {
  const w = await withSecond({ cases: [{ case: 'figma', decision: 'apply' }] });
  await w.step({ op: 'rm', field: 'o', value: 'r2' });
  const job = w.jobOf({ op: 'input', field: 'profile', text: 'только удалёнка', messageId: 0 });
  const plan = await w.run('n8n/w11-profile/plan.js', { job });
  assert.equal(plan.route, 'llm');
  assert.equal(plan.mode, 'revise');
  assert.deepEqual(plan.draft.search.roles, ['34'], 'the draft is the second resume, not the main one');
  assert.deepEqual(plan.draft.search.in_name, ['дизайнер']);
  assert.equal(plan.draft.facts.position, 'Дизайнер');
  // нейросеть вернула правку
  const profile = await loadProfile();
  const draft = profile.draftFromAnswer({ ...designerAnswer, search: { ...designerAnswer.search, in_name: ['дизайнер', 'ui дизайнер'] } }, plan.draft);
  let out = await w.run('n8n/w11-profile/step.js', { job, plan, nodes: { 'Parse profile': { ok: true, draft }, 'Build extract': { mode: 'revise' } } });
  assert.equal(out.view.layout, 'pf review');
  assert.equal(w.state.mode, 'revise');
  out = await w.step({ op: 'confirm', value: 'yes' });
  assert.equal(out.view.layout, 'rm card');
  const data = w.settings['resume.r2'];
  assert.deepEqual(data.in_name, ['дизайнер', 'ui дизайнер']);
  assert.equal(data.extra, 'мои проекты', 'extra kept');
  assert.deepEqual(data.cases, [{ case: 'figma', decision: 'apply' }], 'own cases kept');
  assert.equal(data.resume, RESUME, 'text kept');
  assert.equal(w.settings['profile.facts'].position, 'Frontend-разработчик', 'main facts untouched');
  assert.equal(w.settings['search.in_name'], undefined);
});

test('new text for the second resume: PDF after «📄 Новый текст», «Только текст» saves into resume.r2', async () => {
  const w = await withSecond();
  let out = await w.step({ op: 'rm', field: 'txt', value: 'r2' });
  assert.equal(out.view.layout, 'rm wait');
  assert.equal(w.state.await.id, 'r2');
  const pdfJob = w.jobOf({ op: 'pdf', file: { id: 'f', name: 'design.pdf', size: 1000 }, messageId: 0 });
  const pdf = await w.run('n8n/w11-profile/pdf-text.js', { job: pdfJob, input: { text: RESUME + ' новое' } });
  assert.equal(pdf.replace, true);
  assert.equal(w.state.pending.target, 'r2');
  out = await w.run('n8n/w11-profile/step.js', { job: pdfJob, nodes: { 'PDF text': pdf } });
  assert.equal(out.view.layout, 'pf replace');
  assert.match(out.view.text, /для резюме «Дизайнер»/);
  out = await w.step({ op: 'replace', value: 'text' });
  assert.equal(w.settings['resume.r2'].resume, `${RESUME.trim()} новое`);
  assert.equal(w.settings['profile.resume'], main()['profile.resume'], 'main text untouched');
  assert.equal(out.view.layout, 'rm card');
});

test('stale ids and crafted callbacks do not break anything', async () => {
  const w = await withSecond();
  let out = await w.step({ op: 'rm', field: 'o', value: 'r5' });
  assert.equal(out.view.layout, 'rm list2');
  assert.match(out.view.text, /нет/);
  out = await w.step({ op: 'rm', field: 'del', value: 'r9:y' });
  assert.equal(listOf(w).length, 2);
  out = await w.step({ op: 'rm', field: 'nonsense' });
  assert.equal(out.view.layout, 'rm list2');
});

test('main profile panel mentions several resumes only when there are several', async () => {
  const one = world(main());
  let out = await one.step({ op: 'view' });
  assert.ok(!/Всего резюме/.test(out.view.text));
  const two = await withSecond();
  out = await two.step({ op: 'view' });
  assert.match(out.view.text, /Всего резюме: 2, ищут 2/);
});

// W3 «Route»: кнопки rm:* и ответы на вопросы нового резюме
async function route(update) {
  const fn = compile('n8n/w3-telegram/route.js');
  const $ = (name) => {
    if (name !== 'Telegram Trigger') throw new Error(name);
    return accessor([{ json: update }]);
  };
  return fn($, accessor([]), () => ({}), {});
}
const press = (data) => ({ callback_query: { id: 'q1', data, from: { username: 'ivan' }, message: { message_id: 9, chat: { id: 1 } } } });
const reply = (text, to) => ({ message: { message_id: 10, text, chat: { id: 1 }, reply_to_message: { message_id: 8, text: to } } });

test('route: rm buttons go to W11 as op rm', async () => {
  for (const [data, field, value] of [
    ['rm:list', 'list', ''],
    ['rm:new', 'new', ''],
    ['rm:o:r2', 'o', 'r2'],
    ['rm:on:r3:l', 'on', 'r3:l'],
    ['rm:off:r2', 'off', 'r2'],
    ['rm:ren:r2', 'ren', 'r2'],
    ['rm:clone:r1', 'clone', 'r1'],
    ['rm:del:r2', 'del', 'r2'],
    ['rm:del:r2:y', 'del', 'r2:y'],
    ['rm:txt:r4', 'txt', 'r4'],
  ]) {
    const [item] = await route(press(data));
    assert.equal(item.json.action, 'profile', data);
    assert.equal(item.json.op, 'rm', data);
    assert.equal(item.json.field, field, data);
    assert.equal(item.json.value, value, data);
    assert.equal(item.json.messageId, 9);
    assert.equal(item.json.queryId, 'q1');
  }
});

test('route: malformed rm callbacks are ignored', async () => {
  for (const data of ['rm:o:r9', 'rm:o:x', 'rm:evil:r1', 'rm:del:r2:z', 'rm:']) {
    assert.deepEqual(await route(press(data)), [], data);
  }
});

test('route: pf:new:add reaches W11 as replace/add', async () => {
  const [item] = await route(press('pf:new:add'));
  assert.equal(item.json.action, 'profile');
  assert.equal(item.json.op, 'replace');
  assert.equal(item.json.value, 'add');
});

test('route: replies to the new-resume and rename questions', async () => {
  const [a] = await route(reply(RESUME, '➕ Новое резюме\nПришли резюме PDF-файлом…'));
  assert.equal(a.json.action, 'profile');
  assert.equal(a.json.op, 'input');
  assert.equal(a.json.field, 'newresume');
  assert.equal(a.json.promptId, 8);
  assert.ok(a.json.text.length <= 4000);
  const [b] = await route(reply('Дизайнер', '✏️ Название резюме\nКак назвать резюме…'));
  assert.equal(b.json.field, 'rname');
});

// W7 «Render»: ⚙️ Настройки при нескольких резюме
async function settingsView(settings, section = 'root') {
  const w = world(settings);
  const job = { view: 'settings', section, chatId: '1', messageId: 5, userMessageId: 0, queryId: '', tab: '', page: 1, id: 0 };
  const out = await w.run('n8n/w7-menu/render.js', { job, nodes: { Rows: {}, Runs: {} } });
  return out;
}

test('settings root: one resume — no resume line; several — a line and a note in the main resume sections', async () => {
  let out = await settingsView(main());
  assert.equal(out.layout, 'settings');
  assert.ok(!/Резюме<\/b>/.test(out.text), 'nothing new for one resume');
  const two = main({
    resumes: [{ id: 'r1', name: 'Frontend', active: true, hh: null }, { id: 'r2', name: 'Дизайнер', active: false, hh: null }],
  });
  out = await settingsView(two);
  assert.match(out.text, /📄 <b>Резюме<\/b>: 2 · ищут 1/);
  for (const section of ['search', 'filter', 'llm']) {
    out = await settingsView(two, section);
    assert.match(out.text, /настройки основного резюме/, section);
  }
  out = await settingsView(main(), 'search');
  assert.ok(!/основного резюме/.test(out.text), 'no note for one resume');
});

// ---------- Импорт резюме с hh ----------
const HA = 'a'.repeat(38);
const HB = 'b'.repeat(38);
const HC = 'c'.repeat(38);
const HD = 'd'.repeat(38);
const hhListBody = (hashes) => ({
  ok: true,
  resumes: hashes.map(([hash, title, access = 'clients']) => ({ hash, title, access, status: 'published', updated: '2026-10-12T10:00:00.000Z' })),
  resume: { hash: hashes[0][0], title: hashes[0][1] },
});
const hhDetail = (hash, title, extra = {}) => ({
  hash,
  title,
  about: 'Веду учёт, сдаю отчётность, закрываю месяц. Опыт в производстве и торговле.',
  keySkills: ['1С:Бухгалтерия', 'НДС', 'Первичка'],
  places: [
    { hhId: 1, company: 'Студия', position: 'Бухгалтер', description: 'Первичка, банк, закрытие периода.', start: '2023-02-01', end: '' },
    { hhId: 2, company: 'Торг', position: 'Помощник бухгалтера', description: 'Сверки с контрагентами.', start: '2020-01-01', end: '2023-01-01' },
  ],
  roles: [{ id: '18', text: 'Бухгалтер' }],
  formats: ['REMOTE'],
  salary: { amount: 90000, currency: 'RUR' },
  months: 61,
  ...extra,
});
const ok = (body) => ({ statusCode: 200, body });
const accountantAnswer = {
  facts: { name: '', first_name: '', gender: 'unknown', position: 'Бухгалтер', position_gen: 'бухгалтера', level: 'middle', years: 3, skills: ['1С'], companies: ['Студия'], english: '', city: '', country: '', formats: ['ON_SITE'], salary_amount: 0, salary_currency: '' },
  about: ['Бухгалтер, 5 лет'],
  search: { roles: ['34'], in_name: ['бухгалтер', 'бухгалтер на участок', 'accountant'], anywhere: [], stop_words: ['кассир'] },
  rules: { skip: ['главный бухгалтер'], maybe: [], apply: ['первичка и банк'], ignore: [] },
};
const llmReply = (answer) => ({ statusCode: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] } });

// Мир импорта: список резюме hh прочитан, выбор на панели
async function importWorld(extraSettings = {}) {
  const w = world(main({ cv: { v: 1, places: [], resumes: [{ id: 'r1', hh: { hash: HA, title: 'Frontend (hh)' }, template: '', title: '', about: '', keySkills: [] }] }, ...extraSettings }));
  const job = w.jobOf({ op: 'rm', field: 'imp' });
  const plan = await w.run('n8n/w11-profile/plan.js', { job });
  const hh = await w.run('n8n/w11-profile/hh-resume.js', { job, plan, input: ok(hhListBody([[HA, 'Frontend (hh)'], [HB, 'Бухгалтер'], [HC, 'Бухгалтер (копия)', 'no_one']])) });
  const out = await w.run('n8n/w11-profile/step.js', { job, plan, nodes: { 'HH resume': hh } });
  return { w, plan, hh, out };
}
// Нажатие rm:i:<sid>:<действие>: Plan решает, читать ли через робота (route hh) или показать экран (Step)
async function pressImport(w, arg, extra = {}) {
  const job = w.jobOf({ op: 'rm', field: 'i', value: `${w.state.imp?.sid ?? 'zzzz'}:${arg}`, ...extra });
  const plan = await w.run('n8n/w11-profile/plan.js', { job });
  if (plan.route === 'hh') return { plan, job };
  const out = await w.run('n8n/w11-profile/step.js', { job, plan });
  w.save(out);
  return { plan, job, out };
}
// Чтение резюме роботом, разбор нейросетью, экран «разобрано» (то, что делает цепочка Read hh → … → Step)
async function readAndParse(w, plan, job, { answer = accountantAnswer, hhReply, llm } = {}) {
  const hhRes = await w.run('n8n/w11-profile/hh-resume.js', { job, plan, input: hhReply ?? ok({ ok: true, resumes: [], resume: hhDetail(plan.hash, plan.importing.title) }) });
  if (!hhRes.toLlm) {
    const out = await w.run('n8n/w11-profile/step.js', { job, plan, nodes: { 'HH resume': hhRes } });
    w.save(out);
    return { hhRes, out };
  }
  const parsed = (
    await w.run('n8n/w11-profile/parse-profile.js', {
      job,
      plan,
      nodes: { 'Build extract': { provider: 'gemini', mode: 'extract' }, 'HH resume': hhRes },
      input: llm ?? llmReply(answer),
    })
  );
  const out = await w.run('n8n/w11-profile/step.js', { job, plan, nodes: { 'HH resume': hhRes, 'Parse profile': parsed, 'Build extract': { mode: 'extract' } } });
  w.save(out);
  return { hhRes, parsed, out };
}

test('import: «📥 Импорт с hh» — робот читает список, панель с галочками, уже связанные отмечены', async () => {
  const { w, plan, hh, out } = await importWorld();
  assert.equal(plan.route, 'hh');
  assert.equal(plan.mode, 'list');
  assert.match(plan.wait.text, /Читаю список резюме на hh/);
  assert.equal(hh.hh, 'list');
  assert.equal(w.state.imp.list.length, 3);
  assert.equal(w.state.imp.list[0].linked, 'r1', 'основное уже связано с первым резюме hh');
  assert.equal(w.state.imp.list[1].linked, '');
  assert.equal(out.view.layout, 'rm imp3');
  assert.match(out.view.text, /резюме на hh: 3/);
  assert.match(out.view.text, /✅ <b>Frontend \(hh\)<\/b>/);
  assert.match(out.view.text, /уже в боте: «Frontend-разработчик»/);
  assert.match(out.view.text, /⬜ <b>Бухгалтер<\/b>/);
  assert.match(out.view.text, /🙈 скрыто от работодателей/);
  assert.equal(out.view.b.i1.cb, `rm:i:${w.state.imp.sid}:1`);
  assert.equal(out.view.b.go.cb, `rm:i:${w.state.imp.sid}:go`);
  assert.equal(out.view.b.go.text, '📥 Импортировать');
});

test('import: галочки — отметить, снять, уже связанное не отмечается, больше свободных мест нельзя', async () => {
  const { w } = await importWorld();
  let r = await pressImport(w, '1');
  assert.match(r.out.view.text, /☑️ <b>Бухгалтер<\/b>/);
  assert.equal(r.out.view.b.go.text, '📥 Импортировать (1)');
  r = await pressImport(w, '1');
  assert.match(r.out.view.text, /⬜ <b>Бухгалтер<\/b>/);
  r = await pressImport(w, '0');
  assert.match(r.out.view.text, /уже в боте/);
  assert.deepEqual(w.state.imp.selected, []);
  // место только одно: у основного и трёх других резюме остаётся 1
  w.settings.resumes = [1, 2, 3, 4].map((n) => ({ id: `r${n}`, name: `R${n}`, active: true, hh: null }));
  r = await pressImport(w, '1');
  assert.deepEqual(w.state.imp.selected, [HB]);
  r = await pressImport(w, '2');
  assert.match(r.out.view.text, /Свободно мест: 1/);
  assert.deepEqual(w.state.imp.selected, [HB]);
});

test('import: устаревшая панель и чужие нажатия не ломают', async () => {
  const { w } = await importWorld();
  const job = w.jobOf({ op: 'rm', field: 'i', value: 'zzzz:go' });
  const plan = await w.run('n8n/w11-profile/plan.js', { job });
  assert.equal(plan.route, 'step');
  const out = await w.run('n8n/w11-profile/step.js', { job, plan });
  assert.equal(out.view.layout, 'rm list1');
  assert.match(out.view.text, /Импорт устарел/);
  const empty = world(main());
  const j2 = empty.jobOf({ op: 'rm', field: 'i', value: 'abcd:go' });
  const p2 = await empty.run('n8n/w11-profile/plan.js', { job: j2 });
  assert.equal(p2.route, 'step', 'без начатого импорта читать нечего');
});

test('import: «Импортировать» без галочек — подсказка, не чтение', async () => {
  const { w } = await importWorld();
  const r = await pressImport(w, 'go');
  assert.equal(r.plan?.route, 'step');
  assert.equal(r.out.view.layout, 'rm imp3');
  assert.match(r.out.view.text, /Отметь хотя бы одно резюме/);
});

test('import: «🔗 Это основное» связывает основное, только если оно не связано и отмечено одно', async () => {
  const { w } = await importWorld({ cv: null });
  // основное не связано (cv нет)
  let r = await pressImport(w, 'b');
  assert.match(r.out.view.text, /Отметь ровно одно резюме/);
  await pressImport(w, '1');
  await pressImport(w, '2');
  r = await pressImport(w, 'b');
  assert.match(r.out.view.text, /Отметь ровно одно резюме/, 'два отмеченных');
  await pressImport(w, '2');
  r = await pressImport(w, 'b');
  assert.match(r.out.view.text, /Основное резюме связано с «Бухгалтер»/);
  assert.deepEqual(w.settings.resumes[0].hh, { hash: HB, title: 'Бухгалтер' });
  assert.equal(w.state.imp.list[1].linked, 'r1');
  r = await pressImport(w, 'b');
  assert.match(r.out.view.text, /уже связано с «Бухгалтер»/);
});

test('import: чтение резюме — текст как на hh, факты hh, ошибки робота', async () => {
  const { w } = await importWorld();
  await pressImport(w, '1');
  const { plan, job } = await pressImport(w, 'go');
  assert.equal(plan.route, 'hh');
  assert.equal(plan.mode, 'detail');
  assert.equal(plan.hash, HB);
  assert.deepEqual(plan.importing, { hash: HB, title: 'Бухгалтер' });
  assert.match(plan.wait.text, /Читаю «Бухгалтер» на hh… \(1 из 1\)/);
  assert.equal(plan.inherit.city, 'Казань', 'факты о человеке — из основного');
  const hh = await w.run('n8n/w11-profile/hh-resume.js', { job, plan, input: ok({ ok: true, resumes: [], resume: hhDetail(HB, 'Бухгалтер') }) });
  assert.equal(hh.toLlm, true);
  assert.equal(hh.create, true);
  assert.match(hh.text, /^Бухгалтер\n\nОпыт работы — 5 лет 1 месяц\n\nКлючевые навыки\n1С:Бухгалтерия, НДС, Первичка\n\nОбо мне\n/);
  assert.match(hh.text, /Места работы\n\nСтудия — февраль 2023 — по настоящее время\nБухгалтер\nПервичка/);
  assert.match(hh.text, /Торг — январь 2020 — январь 2023\nПомощник бухгалтера/);
  assert.equal(w.state.text, hh.text);
  assert.deepEqual(hh.hh, { roles: [{ id: '18', text: 'Бухгалтер' }], formats: ['REMOTE'], salary: { amount: 90000, currency: 'RUR' }, months: 61 });
  // сбои робота
  const bad = async (res) => (await w.run('n8n/w11-profile/hh-resume.js', { job, plan, input: res })).hhError;
  assert.equal(await bad({ error: { message: 'ECONNREFUSED' } }), 'down');
  assert.equal(await bad({ statusCode: 409, body: { error: 'busy' } }), 'busy');
  assert.equal(await bad({ statusCode: 423, body: { blocked: { kind: 'captcha' } } }), 'blocked:captcha');
  assert.equal(await bad({ statusCode: 500, body: null }), 'http:500');
  assert.equal(await bad({ statusCode: 200, body: { ok: false, error: 'not_found' } }), 'not_found');
  assert.equal(await bad(ok({ ok: true, resumes: [], resume: hhDetail(HC, 'Другое') })), 'not_found', 'пришло не то резюме');
  assert.equal(await bad(ok({ ok: true, resumes: [], resume: { hash: HB, title: 'Пусто', about: '', keySkills: [], places: [] } })), 'empty');
});

test('import: разбор нейросетью — роли, формат, зарплата и стаж с hh, пол и город из основного', async () => {
  const { w } = await importWorld();
  await pressImport(w, '1');
  const { plan, job } = await pressImport(w, 'go');
  const { parsed, out } = await readAndParse(w, plan, job);
  const draft = parsed.draft;
  assert.deepEqual(draft.search.roles, ['18'], 'роль hh вместо угаданной нейросетью');
  assert.deepEqual(draft.facts.formats, ['REMOTE']);
  assert.deepEqual(draft.facts.salary, { amount: 90000, currency: 'RUR' });
  assert.equal(draft.facts.years, 5.1);
  assert.equal(draft.facts.gender, 'm');
  assert.equal(draft.facts.city, 'Казань');
  assert.equal(out.view.layout, 'pf review');
  assert.match(out.view.text, /Резюме с hh разобрано<\/b>: «Бухгалтер»/);
  assert.equal(w.state.mode, 'create');
  assert.deepEqual(w.state.draftHh, { hash: HB, title: 'Бухгалтер' });
  assert.equal(out.save, null, 'до ✅ ничего не сохранено');
});

test('import: ✅ сохраняет резюме со связью с hh; единственное — сразу карточка', async () => {
  const { w } = await importWorld();
  await pressImport(w, '1');
  const { plan, job } = await pressImport(w, 'go');
  await readAndParse(w, plan, job);
  const out = await w.step({ op: 'confirm', value: 'yes' });
  assert.equal(out.view.layout, 'rm card');
  assert.match(out.view.text, /Резюме импортировано/);
  const added = w.settings.resumes[1];
  assert.deepEqual([added.id, added.name, added.active], ['r2', 'Бухгалтер', true]);
  assert.deepEqual(added.hh, { hash: HB, title: 'Бухгалтер' });
  assert.deepEqual(w.settings['resume.r2'].roles, ['18']);
  assert.match(w.settings['resume.r2'].resume, /Ключевые навыки/);
  assert.equal(w.state.imp, undefined, 'импорт закончен');
  assert.equal(w.state.draftHh, undefined);
  assert.equal(w.settings['profile.signature'], 'Иван', 'общее не тронуто');
});

test('import: очередь из двух — ✅, «Дальше», ❌ → итог', async () => {
  const { w } = await importWorld();
  await pressImport(w, '1');
  await pressImport(w, '2');
  let { plan, job } = await pressImport(w, 'go');
  assert.equal(plan.hash, HB);
  assert.match(plan.wait.text, /\(1 из 2\)/);
  await readAndParse(w, plan, job);
  let out = await w.step({ op: 'confirm', value: 'yes' });
  assert.equal(out.view.layout, 'rm imp next');
  assert.match(out.view.text, /Сохранил «Бухгалтер»/);
  assert.match(out.view.text, /Дальше: «Бухгалтер \(копия\)» \(осталось 1\)/);
  assert.equal(out.view.b.next.cb, `rm:i:${w.state.imp.sid}:next`);
  // ▶️ Дальше
  ({ plan, job } = await pressImport(w, 'next'));
  assert.equal(plan.hash, HC);
  assert.match(plan.wait.text, /\(2 из 2\)/);
  const second = await readAndParse(w, plan, job);
  assert.match(second.out.view.text, /Резюме с hh разобрано<\/b>: «Бухгалтер \(копия\)»/);
  // ❌ — пропустить: очередь кончилась, итог
  out = await w.step({ op: 'confirm', value: 'no' });
  assert.equal(out.view.layout, 'rm list2');
  assert.match(out.view.text, /Импорт завершён: сохранено 1: «Бухгалтер»; пропущено 1: «Бухгалтер \(копия\)»/);
  assert.equal(w.settings.resumes.length, 2);
  assert.equal(w.state.imp, undefined);
});

test('import: сбой робота на резюме — повторить, пропустить, хватит', async () => {
  const { w } = await importWorld();
  await pressImport(w, '1');
  await pressImport(w, '2');
  let { plan, job } = await pressImport(w, 'go');
  let r = await readAndParse(w, plan, job, { hhReply: { statusCode: 423, body: { blocked: { kind: 'captcha' } } } });
  assert.equal(r.out.view.layout, 'rm imp error');
  assert.match(r.out.view.text, /«Бухгалтер»/);
  assert.match(r.out.view.text, /робот на паузе \(captcha\)/);
  // 🔄 повторить то же
  ({ plan, job } = await pressImport(w, 'retry'));
  assert.equal(plan.route, 'hh');
  assert.equal(plan.hash, HB);
  r = await readAndParse(w, plan, job);
  assert.equal(r.out.view.layout, 'pf review');
  // ❌ на разборе → дальше по очереди
  const out = await w.step({ op: 'confirm', value: 'no' });
  assert.equal(out.view.layout, 'rm imp next');
  assert.match(out.view.text, /Пропустил «Бухгалтер»/);
  // дальше → сбой → ⏭ пропустить → итог; ничего не сохранено
  ({ plan, job } = await pressImport(w, 'next'));
  r = await readAndParse(w, plan, job, { hhReply: { error: { message: 'down' } } });
  assert.equal(r.out.view.layout, 'rm imp error');
  assert.match(r.out.view.text, /робот не отвечает/);
  const end = await pressImport(w, 'skip');
  assert.equal(end.out.view.layout, 'rm list1');
  assert.match(end.out.view.text, /Импорт завершён: пропущено 2/);
  assert.equal(w.settings.resumes, undefined, 'ничего не сохранено');
});

test('import: нейросеть не разобрала — панель сбоя; список не прочитан — «Повторить» с начала', async () => {
  const { w } = await importWorld();
  await pressImport(w, '1');
  const { plan, job } = await pressImport(w, 'go');
  let r = await readAndParse(w, plan, job, { llm: { statusCode: 503, body: { error: { message: 'high demand' } } } });
  assert.equal(r.out.view.layout, 'rm imp error');
  assert.match(r.out.view.text, /нейросеть не разобрала резюме \(нейросеть ответила HTTP 503/);
  // лимит запросов: подсказка про «Повторить», а не «пришли PDF ещё раз»
  r = await readAndParse(w, plan, job, { llm: { statusCode: 429, body: { error: { message: 'quota' } } } });
  assert.match(r.out.view.text, /лимит запросов к нейросети \(429\) — нажми «🔄 Повторить» через минуту/);
  assert.ok(!/пришли PDF/.test(r.out.view.text));
  assert.equal(w.state.draftHh, undefined);
  // список: робот не ответил
  const w2 = world(main());
  const job2 = w2.jobOf({ op: 'rm', field: 'imp' });
  const plan2 = await w2.run('n8n/w11-profile/plan.js', { job: job2 });
  const hh = await w2.run('n8n/w11-profile/hh-resume.js', { job: job2, plan: plan2, input: { error: { message: 'ECONNREFUSED' } } });
  assert.equal(hh.hhError, 'down');
  const out = await w2.run('n8n/w11-profile/step.js', { job: job2, plan: plan2, nodes: { 'HH resume': hh } });
  assert.equal(out.view.layout, 'rm hh error');
  assert.match(out.view.text, /робот не отвечает/);
  assert.equal(w2.state.imp, undefined);
});

test('import: правка разобранного резюме не теряет связь с hh и не применяет hh повторно', async () => {
  const { w } = await importWorld();
  await pressImport(w, '1');
  const { plan, job } = await pressImport(w, 'go');
  await readAndParse(w, plan, job);
  const reviseJob = w.jobOf({ op: 'input', field: 'profile', text: 'ищи ещё главбуха', messageId: 0 });
  const revisePlan = await w.run('n8n/w11-profile/plan.js', { job: reviseJob });
  assert.equal(revisePlan.mode, 'revise');
  assert.equal(revisePlan.create, true);
  const profile = await loadProfile();
  const draft = profile.draftFromAnswer({ ...accountantAnswer, search: { ...accountantAnswer.search, roles: ['18', '34'] } }, revisePlan.draft);
  const out = await w.run('n8n/w11-profile/step.js', { job: reviseJob, plan: revisePlan, nodes: { 'Parse profile': { ok: true, draft }, 'Build extract': { mode: 'revise' } } });
  assert.equal(out.view.layout, 'pf review');
  assert.deepEqual(w.state.draftHh, { hash: HB, title: 'Бухгалтер' });
  await w.step({ op: 'confirm', value: 'yes' });
  assert.deepEqual(w.settings.resumes[1].hh, { hash: HB, title: 'Бухгалтер' });
  assert.deepEqual(w.settings['resume.r2'].roles, ['18', '34']);
});

test('import: брошенный импорт не цепляет hh к следующему новому резюме', async () => {
  const { w } = await importWorld();
  await pressImport(w, '1');
  const { plan, job } = await pressImport(w, 'go');
  await readAndParse(w, plan, job); // разобрано, но ни ✅, ни ❌
  assert.ok(w.state.draftHh);
  // новое резюме из текста: другой черновик
  await w.step({ op: 'rm', field: 'new' });
  const textJob = w.jobOf({ op: 'input', field: 'newresume', text: RESUME, messageId: 0 });
  const textPlan = await w.run('n8n/w11-profile/plan.js', { job: textJob });
  const parsed = await parseDraft(w, textPlan);
  await w.run('n8n/w11-profile/step.js', { job: textJob, plan: textPlan, nodes: { 'Parse profile': parsed, 'Build extract': { mode: 'extract' } } });
  assert.equal(w.state.draftHh, undefined, 'связь с hh снята');
  await w.step({ op: 'confirm', value: 'yes' });
  assert.equal(w.settings.resumes[1].hh, null);
});

test('import: нет свободных мест — список не читаем', async () => {
  const list = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => ({ id, name: id, active: true, hh: null }));
  const w = world(main({ resumes: list }));
  const job = w.jobOf({ op: 'rm', field: 'imp' });
  const plan = await w.run('n8n/w11-profile/plan.js', { job });
  assert.equal(plan.route, 'step');
  assert.match(plan.problem, /предел/);
});

test('import: «⏹ Хватит» в очереди — итог, остальные не импортированы', async () => {
  const { w } = await importWorld();
  await pressImport(w, '1');
  await pressImport(w, '2');
  const { plan, job } = await pressImport(w, 'go');
  await readAndParse(w, plan, job);
  await w.step({ op: 'confirm', value: 'yes' });
  const stop = await pressImport(w, 'x');
  assert.equal(stop.out.view.layout, 'rm list2');
  assert.match(stop.out.view.text, /Импорт завершён: сохранено 1/);
  assert.match(stop.out.view.text, /Остальные не импортировал/);
});

test('route: кнопки импорта rm:imp и rm:i:<сессия>:<действие>', async () => {
  const [a] = await route(press('rm:imp'));
  assert.equal(a.json.action, 'profile');
  assert.equal(a.json.op, 'rm');
  assert.equal(a.json.field, 'imp');
  for (const arg of ['0', '5', 'b', 'x', 'go', 'next', 'retry', 'skip']) {
    const [item] = await route(press(`rm:i:ab12:${arg}`));
    assert.equal(item.json.field, 'i', arg);
    assert.equal(item.json.value, `ab12:${arg}`, arg);
  }
  for (const bad of ['rm:i:ab12:9x', 'rm:i:abc:go', 'rm:i:ab12:', 'rm:i:AB12:go', 'rm:i:ab12:go:x']) {
    assert.deepEqual(await route(press(bad)), [], bad);
  }
});

test('import: названия связанных резюме на hh обновляются при чтении списка', async () => {
  const w = world(
    main({
      cv: { v: 1, places: [], resumes: [{ id: 'r1', hh: { hash: HA, title: 'Старое название' }, template: '', title: '', about: '', keySkills: [] }] },
      resumes: [{ id: 'r1', name: 'Frontend', active: true, hh: { hash: HA, title: 'Старое название' } }, { id: 'r2', name: 'Бух', active: true, hh: { hash: HB, title: 'Тоже старое' } }],
      'resume.r2': { resume: RESUME, in_name: ['бухгалтер'] },
    }),
  );
  const job = w.jobOf({ op: 'rm', field: 'imp' });
  const plan = await w.run('n8n/w11-profile/plan.js', { job });
  const hh = await w.run('n8n/w11-profile/hh-resume.js', { job, plan, input: ok(hhListBody([[HA, 'Frontend-разработчик'], [HB, 'Бухгалтер'], [HC, 'Третье']])) });
  const out = await w.run('n8n/w11-profile/step.js', { job, plan, nodes: { 'HH resume': hh } });
  w.save(out);
  assert.deepEqual(w.settings.resumes[0].hh, { hash: HA, title: 'Frontend-разработчик' });
  assert.deepEqual(w.settings.resumes[1].hh, { hash: HB, title: 'Бухгалтер' });
  assert.equal(w.settings.resumes[1].name, 'Бух', 'название в боте не трогаем: оно своё');
  assert.equal(out.view.layout, 'rm imp3');
  // ничего не поменялось на hh — ничего и не пишем
  const again = await w.run('n8n/w11-profile/step.js', { job, plan, nodes: { 'HH resume': hh } });
  assert.equal(again.save, null);
});
