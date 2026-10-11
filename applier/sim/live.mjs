// Симуляция живого отклика (этап 6.1b): настоящий сценарий src/flows/apply.mjs с APPLY_LIVE=1 на поддельном hh
// (sim/hh.mjs). Проверяет ветки после клика и предохранитель до первого настоящего отклика.
// Запуск — sim/run.sh: одноразовый контейнер из образа робота без сети, свой каталог данных.
//   sim/run.sh                 все сценарии
//   sim/run.sh quick           только сценарии, в имени которых есть «quick»
import assert from 'node:assert/strict';
import { config } from '../src/config.mjs';
import { browserContext, ensure, shutdown } from '../src/browser.mjs';
import { applyFlow } from '../src/flows/apply.mjs';
import { store } from '../src/store.mjs';
import { sameText } from '../src/hh/xhr.mjs';
import { handle, posts, useScenario } from './hh.mjs';

if (!config.live) throw new Error('симуляция — только с APPLY_LIVE=1 (sim/run.sh)');
if (config.dataDir === '/data') throw new Error('симуляция — только со своим DATA_DIR, не с томом робота (sim/run.sh)');

const LETTER = 'Здравствуйте!\n\nДелал интерфейсы на React и TypeScript.\n\nДля быстрой связи тг: @sim\nСимуляция';
const ok = [];

// posts — пути разрешённых не-GET запросов по порядку; «аналитика» страницы всегда должна быть порвана
const SCENARIOS = [
  {
    name: 'modal-relocation: окно с письмом после «другая страна»',
    type: 'modal',
    relocation: true,
    expect: { outcome: 'applied', via: 'modal', letter: 'attached', warning: /другой стране/, posts: ['/applicant/vacancy_response/popup'] },
  },
  {
    name: 'visibility: «разрешите работодателям из Узбекистана видеть профиль» → разрешить',
    type: 'modal',
    visibility: 'Узбекистана',
    expect: { outcome: 'applied', via: 'modal', letter: 'attached', warning: /работодателям из Узбекистана/, posts: ['/applicant/vacancy_response/popup'] },
  },
  {
    name: 'quick-chat: один клик → «Приложить» 403 → чат отклика',
    type: 'quickResponse',
    edit: [403, { error: 'notEditable' }],
    expect: {
      outcome: 'applied',
      via: 'quick',
      letter: 'chat',
      posts: ['/applicant/vacancy_response/popup', '/applicant/vacancy_response/edit_ajax', '/chatik/api/notify_chat_opened', '/chatik/api/save'],
    },
  },
  {
    name: 'quick-chat-en: сайт hh на английском — в чате «Add cover letter»',
    type: 'quickResponse',
    edit: [403, { error: 'notEditable' }],
    chatAction: 'Add cover letter',
    expect: {
      outcome: 'applied',
      via: 'quick',
      letter: 'chat',
      posts: ['/applicant/vacancy_response/popup', '/applicant/vacancy_response/edit_ajax', '/chatik/api/notify_chat_opened', '/chatik/api/save'],
    },
  },
  {
    name: 'quick-attach: один клик → «Приложить» прошло',
    type: 'quickResponse',
    edit: [200, {}],
    expect: { outcome: 'applied', via: 'quick', letter: 'attached', posts: ['/applicant/vacancy_response/popup', '/applicant/vacancy_response/edit_ajax'] },
  },
  {
    name: 'limit: hh ответил «лимит откликов»',
    type: 'modal',
    respond: [400, { error: 'negotiationsLimitExceeded' }],
    errorText: 'В течение 24 часов можно совершить не более 200 откликов. Вы исчерпали лимит откликов',
    expect: { outcome: 'limit', blocked: 'limit', posts: ['/applicant/vacancy_response/popup'] },
  },
  {
    name: 'stop: hh ответил «Недопустимое сообщение»',
    type: 'modal',
    respond: [400, { error: 'spamDetected' }],
    errorText: 'Недопустимое сообщение',
    expect: { outcome: 'blocked', blocked: 'blocked', posts: ['/applicant/vacancy_response/popup'] },
  },
  {
    name: 'external: «Откликнуться» открыл сайт работодателя',
    type: 'modal',
    click: 'external',
    expect: { outcome: 'external', posts: [] },
  },
  {
    name: 'captcha: капча внутри окна отклика → человеку',
    type: 'modal',
    captchaInModal: true,
    expect: { outcome: 'captcha', blocked: 'smart', posts: [] },
  },
  {
    name: 'captcha-late: капча появилась, пока робот вставлял письмо — не жать',
    type: 'modal',
    captchaInModal: 'late',
    expect: { outcome: 'captcha', blocked: 'smart', posts: [] },
  },
  {
    name: 'already: прогноз hh — отклик уже есть',
    type: 'alreadyApplied',
    expect: { outcome: 'already', posts: [] },
  },
  {
    name: 'dry: сухой прогон и при APPLY_LIVE=1',
    type: 'modal',
    dry: true,
    expect: { outcome: 'dry_run', posts: [] },
  },
  {
    name: 'stuck: после клика ничего не происходит',
    type: 'modal',
    click: 'nothing',
    expect: { outcome: 'error', posts: [] },
  },
];

await ensure();
await browserContext().route('**/*', handle);

const only = process.argv[2] ?? '';
let n = 0;
for (const sc of SCENARIOS.filter((s) => s.name.includes(only))) {
  sc.id = 990000 + ++n;
  useScenario(sc);
  store.unblock('симуляция');
  const r = await applyFlow({ vacancyId: sc.id, letter: LETTER, dry: Boolean(sc.dry) });
  const e = sc.expect;
  try {
    assert.equal(r.outcome, e.outcome, 'исход');
    if (e.via) assert.equal(r.via, e.via, 'via');
    if (e.letter) assert.equal(r.letter, e.letter, 'письмо');
    if (e.warning) assert.ok(r.warnings?.some((w) => e.warning.test(w)), `предупреждение ${e.warning}: ${r.warnings}`);
    assert.equal(store.blocked?.kind ?? null, e.blocked ?? null, 'блок');
    const passed = posts.filter((p) => !p.blocked);
    assert.deepEqual(passed.map((p) => p.path), e.posts, 'запросы, которые пропустил предохранитель');
    assert.ok(posts.some((p) => p.blocked && p.path === '/shards/applicant/sim_stats'), '«аналитика» страницы порвана');
    // Письмо — наше и целиком (в поле окна hh подставил старое); форма шлёт переводы строк как \r\n
    for (const p of passed) {
      if (p.letter !== null) assert.ok(sameText(p.letter, LETTER), `письмо в ${p.path}: ${JSON.stringify(p.letter)}`);
      if (p.text !== null && p.text !== undefined) assert.ok(sameText(p.text, LETTER), `текст в ${p.path}: ${JSON.stringify(p.text)}`);
    }
    ok.push(sc.name);
    console.log(`✅ ${sc.name} — ${r.outcome}${r.letter ? ` · ${r.letter}` : ''} за ${Math.round(r.ms / 1000)} с`);
    console.log(`   ${r.trace.map((t) => `${t.s}@${(t.ms / 1000).toFixed(1)}`).join(' → ')}`);
  } catch (err) {
    console.log(`❌ ${sc.name}: ${err.message}`);
    console.log(`   исход ${JSON.stringify({ outcome: r.outcome, via: r.via, letter: r.letter, note: r.note, warnings: r.warnings })}`);
    console.log(`   запросы ${JSON.stringify(posts)}`);
    console.log(`   шаги ${r.trace.map((t) => `${t.s}@${(t.ms / 1000).toFixed(1)}`).join(' → ')}`);
  }
}
store.unblock('симуляция');
await shutdown();
const total = SCENARIOS.filter((s) => s.name.includes(only)).length;
console.log(`\n${ok.length} из ${total} сценариев прошли`);
process.exit(ok.length === total ? 0 : 1);
