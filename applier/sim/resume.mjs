// Симуляция разведки резюме (часть D, E0 15.10.2026): настоящий src/flows/recon.mjs → reconResume на поддельном hh.
// Проверяет, что разведка открывает только «Мои резюме», резюме и страницы правки (ссылки-действия — никогда), строгий
// предохранитель рвёт любой не-GET к hh и снимается после разведки, капча и выход из hh останавливают обход.
// Запуск — sim/run.sh resume: одноразовый контейнер из образа робота без сети, свой каталог данных.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.mjs';
import { browserContext, ensure, guardBlocks, shutdown } from '../src/browser.mjs';
import { RECON_DIR, reconResume } from '../src/flows/recon.mjs';
import { store } from '../src/store.mjs';

if (config.dataDir === '/data') throw new Error('симуляция — только со своим DATA_DIR, не с томом робота (sim/run.sh)');

const A = '0123456789abcdef0123456789abcdef012345';
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
      { applicantResumes: [{ hash: A }] },
      `<h1 data-qa="resumes-title">Мои резюме</h1>
<a data-qa="resume-title-link" href="/resume/${A}">Frontend-разработчик (сим)</a>
<a href="/applicant/resumes/touch?resume=${A}">Поднять в поиске</a>`,
    ),
  [`/resume/${A}`]: () =>
    html(
      { resume: { title: { maxLength: 100, value: 'Frontend-разработчик (сим)' }, skills: { conditions: { max_length: 3000 } } } },
      `<h2 data-qa="resume-block-title-position">Frontend-разработчик (сим)</h2>
<a data-qa="resume-block-position-edit" href="/applicant/resumes/edit/position?resume=${A}">Изменить</a>
<a data-qa="resume-block-experience-edit" href="/applicant/resumes/edit/experience?resume=${A}&amp;field=experience">Изменить</a>
<a href="/applicant/resumes/edit/delete?resume=${A}">Удалить</a>
<a href="/applicant/resumes/duplicate?resume=${A}&amp;edit=1">Дублировать</a>
<a href="/applicant/resumes/touch?resume=${A}">Поднять</a>`,
    ),
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

// Что дошло до «hh»: метод, путь, во время разведки ли
const seen = [];
let mode = 'ok'; // ok | captcha | login
let during = false;
async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (guardBlocks(req)) return route.abort('blockedbyclient');
  seen.push({ method: req.method(), path: url.pathname, query: url.search, during });
  if (req.method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
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
  const page = PAGES[url.pathname];
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

await scenario('капча на «Моих резюме» — блок, дальше не идём', async () => {
  seen.length = 0;
  mode = 'captcha';
  const r = await reconResume();
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].captcha, true);
  assert.equal(store.blocked?.kind, 'captcha');
  assert.deepEqual(r.resumes, []);
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
});

await shutdown();
console.log(`\n${ok.length} из 3 сценариев прошли`);
process.exit(ok.length === 3 ? 0 : 1);
