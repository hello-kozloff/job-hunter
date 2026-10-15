// Фейковый режим (этап 6.1a, APPLIER_FAKE=1): браузер не запускается, к hh ни одного запроса. Исходы POST /apply —
// из очереди сценариев (POST /fake {outcomes}, CLI `node scripts/applier.mjs fake …`), по умолчанию applied.
// Так проверяются все ветки n8n (W3 → W9 → Telegram) без риска для аккаунта. Блоки — через store, как у боевого:
// /health показывает их, /captcha «ok» и /resume снимают.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { store } from './store.mjs';
import { RESUME_LIMITS } from './hh/resume.mjs';
import { GROUP } from './hh/state.mjs';
import { sleep, stamp } from './util.mjs';

export const FAKE_OUTCOMES = [
  'applied', // отклик ушёл, письмо приложено
  'applied_chat', // отклик ушёл, письмо — в чат, hh предупредил «другая страна»
  'already',
  'test',
  'external',
  'hidden',
  'archived',
  'error',
  'dry_run',
  'captcha', // блок: текстовая капча (фото в Telegram)
  'smart', // блок: капча «Я не робот»
  'login', // блок: робот вышел из hh
  'limit', // блок: лимит hh до завтра
  'busy', // HTTP 409 — робот занят
  'down', // HTTP 503 — робот «упал»
  'slow', // 20 с, потом applied — проверить ⛔ во время отправки
];
const queue = [];

export function fakePush(outcomes) {
  const bad = outcomes.filter((o) => !FAKE_OUTCOMES.includes(o));
  if (bad.length) return { ok: false, error: `неизвестные исходы: ${bad.join(', ')}`, known: FAKE_OUTCOMES };
  queue.push(...outcomes);
  log('fake.push', { outcomes });
  return { ok: true, queue: [...queue] };
}
export const fakeQueue = () => [...queue];

// Картинка-заглушка для Telegram (PNG 480×270): скриншоты и «капча» в фейковом режиме
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3;
      const stripe = ((x >> 4) + (y >> 4)) % 2 ? 1 : 0.85; // клетка — видно, что это заглушка
      raw[i] = r * stripe;
      raw[i + 1] = g * stripe;
      raw[i + 2] = b * stripe;
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function fakeShot(tag, color) {
  const dir = join(config.dataDir, 'shots');
  mkdirSync(dir, { recursive: true });
  const name = `${stamp()}-fake-${tag}.png`;
  writeFileSync(join(dir, name), png(480, 270, color));
  return name;
}

const result = (outcome, fields = {}) => ({
  outcome,
  group: GROUP[outcome],
  ms: 0,
  trace: [{ s: 'fake', ms: 0 }],
  ...fields,
});

// POST /apply в фейковом режиме → { status, body }
export async function fakeApply({ vacancyId }) {
  const outcome = queue.shift() ?? 'applied';
  log('fake.apply', { vacancyId, outcome });
  switch (outcome) {
    case 'busy':
      return { status: 409, body: { busy: true, by: 'fake' } };
    case 'down':
      return { status: 503, body: { error: 'фейк: робот недоступен' } };
    case 'slow':
      await sleep(20000);
      store.countApplied();
      return { status: 200, body: result('applied', { via: 'modal', letter: 'attached', confirmed: true }) };
    case 'applied':
      store.countApplied();
      return { status: 200, body: result('applied', { via: 'modal', letter: 'attached', confirmed: true }) };
    case 'applied_chat':
      store.countApplied();
      return {
        status: 200,
        body: result('applied', {
          via: 'quick',
          letter: 'chat',
          confirmed: true,
          warnings: ['Вы откликаетесь на вакансию в другой стране'],
        }),
      };
    case 'already':
      return { status: 200, body: result('already', { confirmed: true }) };
    case 'test':
      return { status: 200, body: result('test', { note: 'у вакансии вопросы работодателя' }) };
    case 'external':
      return { status: 200, body: result('external', { note: 'отклик на сайте работодателя' }) };
    case 'hidden':
      return { status: 200, body: result('hidden', { note: 'hh просит открыть резюме этому работодателю' }) };
    case 'archived':
      return { status: 200, body: result('archived') };
    case 'error':
      store.countError();
      return { status: 200, body: result('error', { note: 'фейк: неизвестный экран hh', shot: fakeShot('error', [229, 57, 53]) }) };
    case 'dry_run':
      return {
        status: 200,
        body: result('dry_run', { note: 'фейк: окно с письмом до отправки', shot: fakeShot('dry', [30, 136, 229]) }),
      };
    case 'captcha':
      store.block('captcha', { shot: fakeShot('captcha', [255, 193, 7]) });
      return { status: 200, body: result('captcha') };
    case 'smart':
      store.block('smart', { shot: fakeShot('smart', [255, 152, 0]) });
      return { status: 200, body: result('captcha') };
    case 'login':
      store.block('login');
      return { status: 200, body: result('login') };
    case 'limit':
      store.block('limit', { until: new Date(Date.now() + 12 * 3600 * 1000).toISOString() });
      return { status: 200, body: result('limit') };
    default:
      return { status: 200, body: result('error', { note: `фейк: нет сценария ${outcome}` }) };
  }
}

// POST /captcha: «ok» / «ок» — решено, иначе новая «капча»
export function fakeCaptcha(text) {
  if (store.blocked?.kind !== 'captcha') return { status: 409, body: { ok: false, error: 'капчи нет' } };
  // «ok» латиницей или «ок» кириллицей — решено
  if (/^(ok|ок)$/i.test(String(text).trim())) {
    store.unblock('фейк: капча «ok»');
    return { status: 200, body: { ok: true } };
  }
  return { status: 200, body: { ok: false, kind: 'captcha', shot: fakeShot('captcha', [255, 193, 7]) } };
}

// POST /resume: любой блок снимается
export function fakeResume() {
  if (store.blocked) store.unblock('фейк: продолжить');
  store.resetStreak();
  return { ok: true, loggedIn: true, blocked: null };
}

// POST /resume/read в фейке (часть D, S2): синтетическое резюме — W13 проверяет сверку с hh без hh
export function fakeResumeRead() {
  const hash = 'fa4e00000000000000000000000000000000001';
  const updated = new Date().toISOString();
  const resume = {
    hash,
    title: 'Frontend-разработчик (фейк)',
    about: 'Фейковое резюме робота: проверка W13 без hh.',
    keySkills: ['React', 'TypeScript', 'Next.js'],
    places: [{ hhId: 1001, company: 'Фейк Компания', position: 'Frontend Developer', description: 'Делал интерфейсы на React.', start: '2023-01-01', end: '' }],
    access: 'clients',
    status: 'published',
    updated,
    limits: { ...RESUME_LIMITS, titleNotIn: [] },
  };
  log('fake.resume_read', {});
  return { ok: true, resumes: [{ hash, title: resume.title, access: 'clients', status: 'published', updated }], resume, backup: '' };
}
