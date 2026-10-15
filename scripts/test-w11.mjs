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
