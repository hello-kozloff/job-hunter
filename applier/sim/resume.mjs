// Симуляция разведки, чтения и записи резюме (часть D: E0, S2, E2/E3): настоящие src/flows/recon.mjs → reconResume и
// src/flows/resume.mjs → readResume, writeResume на поддельном hh (формы — с теми же data-qa, что в записи E0).
// Проверяет, что разведка открывает только «Мои резюме», резюме и страницы правки (ссылки-действия — никогда), строгий
// предохранитель рвёт любой не-GET к hh и снимается после разведки, капча и выход из hh останавливают обход.
// Запуск — sim/run.sh resume: одноразовый контейнер из образа робота без сети, свой каталог данных.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.mjs';
import { browserContext, ensure, guardBlocks, shutdown } from '../src/browser.mjs';
import { RECON_DIR, reconResume } from '../src/flows/recon.mjs';
import { RESUME_DIR, readResume, writeResume } from '../src/flows/resume.mjs';
import { store } from '../src/store.mjs';

if (config.dataDir === '/data') throw new Error('симуляция — только со своим DATA_DIR, не с томом робота (sim/run.sh)');

const A = '0123456789abcdef0123456789abcdef012345';
const B = 'fedcba9876543210fedcba9876543210fedcba';
// Резюме в InitialState — как у hh (E0): поля [{ string }], опыт, пределы
const attrs = (hash, access) => ({ _attributes: { hash, status: 'modified', updated: 1792071673577 }, accessType: [{ string: access }] });
// Резюме A меняется записью (живые сценарии): страница резюме показывает текущее
const START = { title: 'Frontend-разработчик (сим)', about: 'О себе: симуляция.', skills: ['React', 'TypeScript'], position: 'Frontend Developer', description: 'Интерфейсы.' };
let cvState = { ...START, skills: [...START.skills] };
const applicantResume = () => ({
  ...attrs(A, 'clients'),
  _conditions: { title: { parts: [{ string: { maxlength: 100 } }] }, keySkills: { maxcount: 30 } },
  title: [{ string: cvState.title }],
  skills: [{ string: cvState.about }],
  keySkills: cvState.skills.map((s) => ({ string: s })),
  experience: [{ id: 501, companyName: 'Сим Компания', position: cvState.position, description: cvState.description, startDate: '2023-01-01', endDate: null }],
});
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// Форма hh: поля, «Сохранить» (POST текстом — без CORS-предзапроса), «шум» автосохранения при загрузке — предохранитель
// обязан порвать его и в живом режиме; несохранённые правки — «Уйти со страницы?» (beforeunload)
const PROFILE_UPDATE = 'https://resume-profile-front.hh.ru/profile/shards/profile/update';
const FORM = (fields, saveQa, saveJs, next, extraJs = '') =>
  html(
    {},
    `${fields}<button type="button" data-qa="${saveQa}">Сохранить</button><div id="drop"></div>
<script>
let dirty = false;
document.addEventListener('input', () => { dirty = true; });
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
fetch('/applicant/resume/edit?resume=${A}&autosave=1', { method: 'POST', body: '{}' }).catch(() => {});
fetch('${PROFILE_UPDATE}?autosave=1', { method: 'POST', body: '{}' }).catch(() => {});
const q = (s) => document.querySelector(s);
const post = (url, data) => fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(data) });
q('[data-qa="${saveQa}"]').addEventListener('click', async () => {
  const r = await (${saveJs})();
  if (r.ok) { dirty = false; location.href = '${next}'; } else document.body.insertAdjacentHTML('beforeend', '<p data-qa="sim-error">Ошибка</p>');
});
${extraJs}
</script>`,
  );
const EDIT = `/applicant/resume/edit?resume=${A}&hhtmSource=resume_partial_edit`;
const chip = (s) => `<div data-qa="chips-trigger-chip-${escHtml(s)}">${escHtml(s)}<button type="button" aria-label="Удалить" data-qa="chip-delete-action">×</button></div>`;
const FORMS = {
  [`/resume/edit/${A}/position`]: () =>
    FORM(`<input data-qa="resume-edit-title-suggest" role="combobox" value="${escHtml(cvState.title)}">`, 'resume-partial-edit-save',
      `() => post('${EDIT}', { title: [q('[data-qa=resume-edit-title-suggest]').value], fingerprintSp: 'sim' })`, `/resume/${A}`),
  [`/resume/edit/${A}/about`]: () =>
    FORM(`<textarea data-qa="resume-editor-about">${escHtml(cvState.about)}</textarea>`, 'resume-partial-edit-save',
      `() => post('${EDIT}', { skills: [q('[data-qa=resume-editor-about]').value] })`, `/resume/${A}`),
  [`/resume/edit/${A}/keySkills`]: () =>
    FORM(
      `<div data-qa="resume-editor-skills-input"><div id="chips">${cvState.skills.map(chip).join('')}</div><input type="text" data-qa="chips-trigger-input" role="combobox"></div>`,
      'resume-partial-edit-save',
      `() => post('${EDIT}', { keySkills: [...document.querySelectorAll('[data-qa^="chips-trigger-chip-"]')].map((e) => e.dataset.qa.replace('chips-trigger-chip-', '')) })`,
      `/resume/edit/${A}/skillsLevels?fromBlock=keySkills`,
      `q('#chips').addEventListener('click', (e) => { const b = e.target.closest('[data-qa="chip-delete-action"]'); if (b) { b.parentElement.remove(); dirty = true; } });
const input = q('[data-qa="chips-trigger-input"]');
input.addEventListener('input', () => { const v = input.value.trim(); q('#drop').innerHTML = v ? '<div data-qa="suggest-drop"><div data-qa="suggest-item-user-input" role="option">' + v.replace(/</g, '&lt;') + '</div></div>' : ''; });
q('#drop').addEventListener('click', (e) => { if (!e.target.closest('[data-qa="suggest-item-user-input"]')) return; const v = input.value.trim(); const d = document.createElement('div'); d.dataset.qa = 'chips-trigger-chip-' + v; d.innerHTML = v.replace(/</g, '&lt;') + '<button type="button" aria-label="Удалить" data-qa="chip-delete-action">×</button>'; q('#chips').append(d); input.value = ''; q('#drop').innerHTML = ''; });`,
    ),
  '/profile/edit/experience/501': () =>
    FORM(
      `<input name="position" data-qa="resume-profile-experience-specific-position-input-0 resume-profile-experience-specific-position-input" role="combobox" value="${escHtml(cvState.position)}"><textarea data-qa="resume-editor-experience-description-input">${escHtml(cvState.description)}</textarea>`,
      'profile-layout-save-button',
      `() => post('${PROFILE_UPDATE}', { profile: { experience: [{ id: 501, position: q('input[name=position]').value, description: q('[data-qa=resume-editor-experience-description-input]').value }] }, resumeFromHash: '${A}' })`,
      `/resume/${A}`,
    ),
  [`/resume/edit/${A}/skillsLevels`]: () => html({}, '<p data-qa="skill">Уровни навыков</p>'),
};
const encode = (o) => JSON.stringify(o).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&#34;');
// Каждая страница сама шлёт «автосохранение» и «аналитику»: строгий предохранитель обязан порвать всё
const NOISE = `<script>
fetch('/shards/resume/sim_autosave', { method: 'POST', body: 'x' }).catch(() => {});
fetch('/shards/applicant/sim_stats', { method: 'POST', body: 'x' }).catch(() => {});
</script>`;
const html = (state, body) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Sim</title></head><body>
<template id="HH-Lux-InitialState">${encode({ userType: 'applicant', ...state })}</template>${body}${NOISE}</body></html>`;

const PAGES = {
  '/applicant/resumes': () =>
    html(
      { applicantResumes: [{ ...attrs(B, 'no_one'), title: [{ string: 'Копия' }] }, { ...attrs(A, 'clients'), title: [{ string: 'Frontend-разработчик (сим)' }] }] },
      `<h1 data-qa="resumes-title">Мои резюме</h1>
<a data-qa="resume-title-link" href="/resume/${A}">Frontend-разработчик (сим)</a>
<a href="/applicant/resumes/touch?resume=${A}">Поднять в поиске</a>`,
    ),
  [`/resume/${A}`]: () =>
    html(
      { resume: { title: { maxLength: 100, value: 'Frontend-разработчик (сим)' }, skills: { conditions: { max_length: 3000 } } }, applicantResume: applicantResume() },
      `<h2 data-qa="resume-block-title-position">Frontend-разработчик (сим)</h2>
<a data-qa="resume-block-position-edit" href="/applicant/resumes/edit/position?resume=${A}">Изменить</a>
<a data-qa="resume-block-experience-edit" href="/applicant/resumes/edit/experience?resume=${A}&amp;field=experience">Изменить</a>
<a href="/applicant/resumes/edit/delete?resume=${A}">Удалить</a>
<a href="/applicant/resumes/duplicate?resume=${A}&amp;edit=1">Дублировать</a>
<a href="/applicant/resumes/touch?resume=${A}">Поднять</a>`,
    ),
  [`/resume/${B}`]: () => html({ applicantResume: { ...applicantResume(), ...attrs(B, 'no_one') } }, '<h2>Копия</h2>'),
  '/applicant/resumes/edit/position': () =>
    html(
      {},
      `<form data-qa="resume-edit-form"><input data-qa="resume-title-input" name="title" maxlength="100" value="Frontend">
<textarea name="skills" maxlength="3000">О себе</textarea><input type="hidden" name="_xsrf" value="secret"></form>
<script>fetch(location.pathname + location.search, { method: 'POST', body: 'autosave' }).catch(() => {});</script>`,
    ),
  '/applicant/resumes/edit/experience': () =>
    html({}, `<form><textarea data-qa="experience-description" name="description" maxlength="4000">Опыт</textarea></form>`),
  '/sim/after': () => html({}, `<p>после разведки</p><script>fetch('/shards/resume/after', { method: 'POST', body: 'x' }).catch(() => {});</script>`),
};

// Что дошло до «hh»: метод, путь, во время разведки ли; posts — не-GET с телом, blocked — что порвал предохранитель
const seen = [];
const posts = [];
const blocked = [];
let mode = 'ok'; // ok | captcha | login | reject
let during = false;
const CORS = { 'access-control-allow-origin': 'https://hh.ru' };
async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (guardBlocks(req)) {
    blocked.push({ host: url.hostname, path: url.pathname, query: url.search });
    return route.abort('blockedbyclient');
  }
  seen.push({ method: req.method(), path: url.pathname, query: url.search, during });
  if (req.method() !== 'GET') {
    let body = null;
    try {
      body = JSON.parse(req.postData() ?? '');
    } catch {
      // не JSON — неважно
    }
    posts.push({ host: url.hostname, path: url.pathname, query: url.search, body });
    const auto = url.search.includes('autosave');
    if (url.pathname === '/applicant/resume/edit' && !auto) {
      if (mode === 'reject') return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"validation"}' });
      if (body?.title) cvState.title = body.title[0];
      if (body?.skills) cvState.about = body.skills[0];
      if (body?.keySkills) cvState.skills = body.keySkills;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resume: { _attributes: { hash: A, hasErrors: false } } }) });
    }
    if (url.hostname === 'resume-profile-front.hh.ru' && url.pathname === '/profile/shards/profile/update' && !auto) {
      const e = body?.profile?.experience?.[0];
      if (e) Object.assign(cvState, { position: e.position, description: e.description });
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '' });
    }
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' });
  }
  if (url.pathname === '/applicant/resumes' && mode === 'captcha') {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><form action="/account/captcha"><input name="captchaText"></form></body></html>',
    });
  }
  // Вход пропал: hh отдаёт страницу гостю (редирект 302 Chromium без сети в симуляции не проходит)
  if (url.pathname === '/applicant/resumes' && mode === 'login') {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html({ userType: 'anonymous' }, '<form data-qa="account-login-form"></form>'),
    });
  }
  const page = PAGES[url.pathname] ?? FORMS[url.pathname];
  if (!page) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'нет' });
  return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page() });
}

const ok = [];
async function scenario(name, fn) {
  try {
    await fn();
    ok.push(name);
    console.log(`✅ ${name}`);
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    console.log(`   запросы ${JSON.stringify(seen.slice(-20))}`);
  }
}

const page = await ensure();
await browserContext().route('**/*', handle);

await scenario('разведка: резюме, правка по ссылкам, действия не открыты, строгий предохранитель', async () => {
  seen.length = 0;
  during = true;
  const r = await reconResume();
  during = false;
  assert.deepEqual(r.resumes.map((x) => [x.hash, x.title]), [[A, 'Frontend-разработчик (сим)']]);
  assert.deepEqual(r.resumes[0].editLinks, [
    'https://hh.ru/applicant/resumes/edit/position?resume=<hash>',
    'https://hh.ru/applicant/resumes/edit/experience?resume=<hash>&field=experience',
  ]);
  assert.deepEqual(r.pages.map((p) => p.name), ['resumes', '01234567/view', '01234567/edit-1-applicant-resumes-edit-position', '01234567/edit-2-applicant-resumes-edit-experience']);
  const opened = seen.filter((s) => s.method === 'GET').map((s) => s.path);
  assert.ok(!opened.some((p) => /touch|delete|duplicate/.test(p)), `открыты действия: ${opened}`);
  assert.deepEqual(seen.filter((s) => s.method !== 'GET'), [], 'не-GET дошёл до hh во время разведки');
  assert.ok(r.blockedPaths.includes('POST /shards/resume/sim_autosave'), `порвано: ${r.blockedPaths}`);
  assert.ok(r.blockedPaths.includes('POST /applicant/resumes/edit/position'), `порвано: ${r.blockedPaths}`);
  const view = r.pages[1];
  assert.equal(view.limits['resume.title.maxLength'], 100);
  assert.equal(view.limits['resume.skills.conditions.max_length'], 3000);
  assert.equal(r.pages[2].fieldLimits, 2);
  // Файлы: бэкап страниц, поля без значений, скриншоты
  const root = join(RECON_DIR, r.dir.split('/').pop());
  for (const f of ['summary.json', 'blocked.json', 'resumes/page.html', '01234567/view/state.json', '01234567/view/dom.json']) {
    assert.ok(existsSync(join(root, f)), `нет файла ${f}`);
  }
  const dom = JSON.parse(readFileSync(join(root, '01234567/edit-1-applicant-resumes-edit-position/dom.json'), 'utf8'));
  assert.ok(!JSON.stringify(dom).includes('secret'), 'значение поля попало в dom.json');
  assert.ok(dom.fields.some((x) => x.name === 'title' && x.maxLength === 100 && x.length === 8));
  assert.ok(readdirSync(join(root, '01234567/view')).some((n) => n.endsWith('.jpg')), 'нет скриншота');
  // После разведки строгий предохранитель снят: обычный не-GET вне /applicant/ снова уходит
  seen.length = 0;
  await page.goto('https://hh.ru/sim/after');
  await page.waitForLoadState('networkidle').catch(() => {});
  assert.ok(seen.some((s) => s.method === 'POST' && s.path === '/shards/resume/after'), 'строгий предохранитель не снят');
});

await scenario('чтение: видимое работодателям резюме, поля, бэкап, строгий предохранитель', async () => {
  seen.length = 0;
  mode = 'ok';
  during = true;
  const r = await readResume();
  during = false;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.resumes.map((x) => [x.hash, x.access]), [[B, 'no_one'], [A, 'clients']]);
  assert.equal(r.resume.hash, A);
  assert.equal(r.resume.title, 'Frontend-разработчик (сим)');
  assert.deepEqual(r.resume.keySkills, ['React', 'TypeScript']);
  assert.deepEqual(r.resume.places.map((p) => [p.hhId, p.company, p.position]), [[501, 'Сим Компания', 'Frontend Developer']]);
  assert.equal(r.resume.limits.title, 100);
  assert.deepEqual(seen.filter((s) => s.method !== 'GET'), [], 'не-GET дошёл до hh во время чтения');
  assert.deepEqual(seen.filter((s) => s.method === 'GET' && s.query === '').map((s) => s.path), ['/applicant/resumes', `/resume/${A}`]);
  const saved = JSON.parse(readFileSync(join(RESUME_DIR, r.backup), 'utf8'));
  assert.equal(saved.resume._attributes.hash, A, 'бэкап');
  // По хешу — копия; такого хеша нет — not_found
  assert.equal((await readResume({ hash: B })).resume.hash, B);
  assert.equal((await readResume({ hash: 'ab'.repeat(19) })).error, 'not_found');
});

await scenario('капча на «Моих резюме» — блок, дальше не идём', async () => {
  seen.length = 0;
  mode = 'captcha';
  const r = await reconResume();
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].captcha, true);
  assert.equal(store.blocked?.kind, 'captcha');
  assert.deepEqual(r.resumes, []);
  store.unblock('симуляция');
  const read = await readResume();
  assert.deepEqual([read.ok, read.error, store.blocked?.kind], [false, 'captcha', 'captcha']);
  store.unblock('симуляция');
});

await scenario('выход из hh — страница гостю, дальше не идём', async () => {
  seen.length = 0;
  mode = 'login';
  const r = await reconResume();
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].login, true);
  assert.deepEqual(r.resumes, []);
  assert.equal(store.blocked, null);
  const read = await readResume();
  assert.deepEqual([read.ok, read.error, store.blocked], [false, 'login', null]);
});

// ---------- Запись (E2/E3) ----------
const CHANGES = [
  { kind: 'title', value: 'Senior Frontend-разработчик (сим)' },
  { kind: 'about', value: 'О себе: новая версия.\nВторая строка.' },
  { kind: 'skills', skills: ['React', 'PHP', 'Next.js'] },
  { kind: 'place', hhId: 501, position: 'Senior Frontend Developer', description: 'Интерфейсы и админка на PHP.' },
];
const ours = () => posts.filter((p) => !p.query.includes('autosave') && (p.path === '/applicant/resume/edit' || p.path === '/profile/shards/profile/update'));
const reset = () => {
  cvState = { ...START, skills: [...START.skills] };
  posts.length = 0;
  blocked.length = 0;
  mode = 'ok';
};

await scenario('запись, сухой прогон: формы заполнены, снимки, ни одного сохранения, «шум» порван', async () => {
  reset();
  const r = await writeResume({ hash: A, changes: CHANGES, dry: true });
  assert.equal(r.live, false);
  assert.deepEqual(r.results.map((x) => [x.kind, x.outcome]), [['title', 'dry'], ['about', 'dry'], ['skills', 'dry'], ['place', 'dry']], JSON.stringify(r.results));
  assert.ok(r.results.every((x) => x.shot), 'снимки');
  assert.deepEqual(ours(), [], 'сохранение дошло до hh в сухом прогоне');
  assert.ok(blocked.some((b) => b.host === 'resume-profile-front.hh.ru'), 'автосохранение опыта не порвано');
  assert.ok(blocked.some((b) => b.path === '/applicant/resume/edit'), 'автосохранение резюме не порвано');
  assert.deepEqual(cvState, START);
  assert.ok(page.url().endsWith(`/resume/${A}`), 'ушёл с формы');
});

await scenario('запись живая: 4 сохранения по одному, тела как у hh, сверка чтением', async () => {
  reset();
  const r = await writeResume({ hash: A, changes: CHANGES, dry: false });
  assert.equal(r.live, true);
  assert.deepEqual(r.results.map((x) => [x.kind, x.outcome]), [['title', 'saved'], ['about', 'saved'], ['skills', 'saved'], ['place', 'saved']], JSON.stringify(r.results));
  const sent = ours();
  assert.deepEqual(sent.map((p) => p.path), ['/applicant/resume/edit', '/applicant/resume/edit', '/applicant/resume/edit', '/profile/shards/profile/update']);
  assert.deepEqual(sent[0].body.title, ['Senior Frontend-разработчик (сим)']);
  assert.deepEqual(sent[1].body.skills, ['О себе: новая версия.\nВторая строка.']);
  assert.deepEqual([...sent[2].body.keySkills].sort(), ['Next.js', 'PHP', 'React']);
  assert.equal(sent[3].body.profile.experience[0].description, 'Интерфейсы и админка на PHP.');
  assert.ok(blocked.some((b) => b.query.includes('autosave')), '«шум» при загрузке рвётся и в живом режиме');
  assert.equal(r.after.title, 'Senior Frontend-разработчик (сим)');
  assert.deepEqual([...r.after.keySkills].sort(), ['Next.js', 'PHP', 'React']);
  assert.equal(r.after.places[0].position, 'Senior Frontend Developer');
});

await scenario('запись: hh отказал на первом разделе — дальше не идём', async () => {
  reset();
  mode = 'reject';
  const r = await writeResume({ hash: A, changes: CHANGES, dry: false });
  assert.deepEqual(r.results.map((x) => [x.kind, x.outcome, x.note]), [['title', 'error', 'validation']]);
  assert.equal(ours().length, 1);
  assert.deepEqual(cvState, START);
});

await scenario('запись: на hh уже так — ничего не сохраняем', async () => {
  reset();
  const same = [{ kind: 'title', value: START.title }, { kind: 'skills', skills: ['typescript', 'React'] }, { kind: 'place', hhId: 501, description: START.description }];
  const r = await writeResume({ hash: A, changes: same, dry: false });
  assert.deepEqual(r.results.map((x) => x.outcome), ['same', 'same', 'same']);
  assert.deepEqual(ours(), []);
  assert.equal(r.after, null);
});

await shutdown();
console.log(`\n${ok.length} из 8 сценариев прошли`);
process.exit(ok.length === 8 ? 0 : 1);
