// Симуляция напоминания (этап 6.3): настоящий сценарий src/flows/remind.mjs с REMIND_LIVE=1 на поддельном hh
// (sim/hh.mjs): отсев по топику отклика, чат, chat_data, отправка chatik/api/send, предохранитель.
// Запуск — sim/run.sh remind [часть имени]: одноразовый контейнер из образа робота без сети, свой каталог данных.
import assert from 'node:assert/strict';
import { config } from '../src/config.mjs';
import { browserContext, browserStatus, ensure, shutdown } from '../src/browser.mjs';
import { remindFlow } from '../src/flows/remind.mjs';
import { store } from '../src/store.mjs';
import { sameText } from '../src/hh/xhr.mjs';
import { handle, posts, useScenario } from './hh.mjs';

if (!config.remindLive) throw new Error('симуляция — только с REMIND_LIVE=1 (sim/run.sh remind)');
if (config.dataDir === '/data') throw new Error('симуляция — только со своим DATA_DIR, не с томом робота (sim/run.sh)');

const TEXT = 'Здравствуйте! Напоминаю про свой отклик.';
const OPENED = '/chatik/api/notify_chat_opened';
const TYPING = '/chatik/api/participant_action';
const SEND = '/chatik/api/send';
// Отклик ждёт ответа, не просмотрен, 5 дней, писать можно
const topic = (extra = {}) => ({ lastState: 'RESPONSE', viewed: false, ageDays: 5, chatId: '7001', inbox: 'AVAILABLE', ...extra });
const waiting = (extra = {}) => ({ topic: topic(), chatWrite: 'ENABLED_AFTER_INVITATION', ...extra });

// posts — пути разрешённых не-GET запросов по порядку; «аналитика» страницы всегда должна быть порвана
const SCENARIOS = [
  { name: 'sent: не просмотрен, писать можно — текст уходит', remind: waiting(), expect: { outcome: 'sent', posts: [OPENED, TYPING, SEND], confirmed: true } },
  {
    name: 'bot: автоответ бота работодателя — напоминать можно',
    remind: waiting({ chat: { messages: [{ bot: true, text: 'Спасибо за отклик! Мы его рассмотрим' }] } }),
    expect: { outcome: 'sent', posts: [OPENED, TYPING, SEND] },
  },
  { name: 'viewed: работодатель открыл отклик — чат не открываем', remind: waiting({ topic: topic({ viewed: true }) }), expect: { outcome: 'viewed', posts: [] } },
  {
    name: 'invited: приглашение при viewed = false — статус важнее',
    remind: waiting({ topic: topic({ lastState: 'INTERVIEW' }) }),
    expect: { outcome: 'invited', posts: [] },
  },
  { name: 'rejected: отказ работодателя', remind: waiting({ topic: topic({ lastState: 'DISCARD', viewed: true }) }), expect: { outcome: 'rejected', posts: [] } },
  { name: 'archived: вакансия в архиве', remind: waiting({ archived: true }), expect: { outcome: 'archived', posts: [] } },
  { name: 'no_topic: отклика на hh нет', remind: { topic: null }, expect: { outcome: 'no_topic', posts: [] } },
  { name: 'too_early: отклику 1 день', remind: waiting({ topic: topic({ ageDays: 1 }) }), expect: { outcome: 'too_early', posts: [] } },
  {
    name: 'closed-vacancy: работодатель отключил переписку — по странице, без чата',
    remind: waiting({ chatWrite: 'DISABLED', topic: topic({ inbox: 'DISABLED_BY_EMPLOYER' }) }),
    expect: { outcome: 'closed', posts: [] },
  },
  { name: 'closed-chat: chat_data — писать нельзя', remind: waiting({ chat: { write: false } }), expect: { outcome: 'closed', posts: [OPENED], note: /DISABLED_BY_EMPLOYER/ } },
  {
    name: 'closed-ui-en: chat_data не пришли, вместо поля — предупреждение (EN)',
    remind: waiting({ chat: { data: false, write: false, warning: 'The employer has turned off the chat for this vacancy' } }),
    expect: { outcome: 'closed', posts: [OPENED], note: /turned off the chat/ },
  },
  {
    name: 'already: напоминание уже в чате (повтор после сбоя)',
    remind: waiting({ chat: { messages: [{ mine: true, text: TEXT }] } }),
    expect: { outcome: 'already', posts: [OPENED] },
  },
  { name: 'wrote: человек уже писал в чат', remind: waiting({ chat: { messages: [{ mine: true, text: 'Добрый день! Есть вопрос' }] } }), expect: { outcome: 'wrote', posts: [OPENED] } },
  {
    name: 'hr-wrote: работодатель писал, хотя «не просмотрен»',
    remind: waiting({ chat: { messages: [{ text: 'Здравствуйте! Подскажите, когда удобно созвониться?' }] } }),
    expect: { outcome: 'viewed', posts: [OPENED] },
  },
  {
    name: 'spam: hh «Недопустимое сообщение» → блок',
    remind: waiting({ send: [400, { errors: [{ type: 'spamDetected' }] }], chat: { sendError: 'Недопустимое сообщение' } }),
    expect: { outcome: 'blocked', posts: [OPENED, TYPING, SEND], blocked: 'blocked' },
  },
  { name: 'send-500: сбой hh при отправке → error', remind: waiting({ send: [500, {}] }), expect: { outcome: 'error', posts: [OPENED, TYPING, SEND], note: /HTTP 500/ } },
  {
    name: 'lost: ответа hh нет, сообщение в чате → sent',
    remind: waiting({ send: 'lost', chat: { optimistic: true } }),
    expect: { outcome: 'sent', posts: [OPENED, TYPING, SEND], confirmed: false },
  },
  { name: 'wrong-chat: открылся чужой чат → не пишем', remind: waiting({ frameChatId: '9999' }), expect: { outcome: 'error', posts: [OPENED], note: /чужой чат/ } },
  { name: 'no-chat-button: на странице нет «Чат» → error', remind: waiting({ noChatButton: true }), expect: { outcome: 'error', posts: [], note: /нет кнопки «Чат»/ } },
  { name: 'dry: сухой прогон — поле найдено, текст не вводится', remind: waiting(), dry: true, expect: { outcome: 'dry_run', posts: [], emptyInput: true } },
  { name: 'captcha: капча на странице вакансии → человеку', remind: waiting({ captcha: true }), expect: { outcome: 'captcha', posts: [], blocked: 'smart' } },
  { name: 'login: робот не вошёл', remind: waiting({ loggedOut: true }), expect: { outcome: 'login', posts: [], blocked: 'login' } },
];

await ensure();
const page = await ensure();
await browserContext().route('**/*', handle);

const only = process.argv[2] ?? '';
const ok = [];
let n = 0;
for (const sc of SCENARIOS.filter((s) => s.name.includes(only))) {
  sc.id = 880000 + ++n;
  useScenario(sc);
  store.unblock('симуляция');
  store.resetStreak();
  const r = await remindFlow({ vacancyId: sc.id, text: TEXT, dry: Boolean(sc.dry) });
  const e = sc.expect;
  try {
    assert.equal(r.outcome, e.outcome, 'исход');
    assert.equal(store.blocked?.kind ?? null, e.blocked ?? null, 'блок');
    const passed = posts.filter((p) => !p.blocked);
    assert.deepEqual(passed.map((p) => p.path), e.posts, 'запросы, которые пропустил предохранитель');
    // Отправили ровно наш текст
    for (const p of passed.filter((x) => x.path === SEND)) assert.ok(sameText(p.text, TEXT), `текст в ${p.path}: ${JSON.stringify(p.text)}`);
    if (e.confirmed !== undefined) assert.equal(r.confirmed, e.confirmed, 'сообщение видно в чате');
    if (e.note) assert.match(r.note ?? '', e.note, 'заметка');
    // Сухой прогон: поле не тронули (набор шлёт «печатает…»)
    if (e.emptyInput) {
      const frame = page.frames().find((f) => /chatik\.hh\.ru\/chat\//.test(f.url()));
      assert.ok(frame, 'чат открыт');
      assert.equal(await frame.locator('textarea').inputValue(), '', 'поле пустое');
      assert.ok(posts.some((p) => p.blocked && p.path === OPENED), '«чат открыт» порван');
    }
    assert.deepEqual(browserStatus().allowed, [], 'после попытки предохранитель закрыт');
    assert.ok(posts.some((p) => p.blocked && p.path === '/shards/applicant/sim_stats'), '«аналитика» страницы порвана');
    ok.push(sc.name);
    console.log(`✅ ${sc.name} — ${r.outcome}${r.note ? ` (${r.note})` : ''} за ${Math.round(r.ms / 1000)} с`);
    console.log(`   ${r.trace.map((t) => `${t.s}@${(t.ms / 1000).toFixed(1)}`).join(' → ')}`);
  } catch (err) {
    console.log(`❌ ${sc.name}: ${err.message}`);
    console.log(`   исход ${JSON.stringify({ outcome: r.outcome, note: r.note, confirmed: r.confirmed, chatId: r.chatId })}`);
    console.log(`   запросы ${JSON.stringify(posts)}`);
    console.log(`   шаги ${r.trace.map((t) => `${t.s}@${(t.ms / 1000).toFixed(1)}`).join(' → ')}`);
  }
}
store.unblock('симуляция');
await shutdown();
const total = SCENARIOS.filter((s) => s.name.includes(only)).length;
console.log(`\n${ok.length} из ${total} сценариев прошли`);
process.exit(ok.length === total ? 0 : 1);
