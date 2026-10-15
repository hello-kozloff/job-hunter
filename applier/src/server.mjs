// HTTP API робота-отклика для n8n (W9, W10) и CLI scripts/applier.mjs. Контракт — docs/stages/stage-6.md.
// n8n решает «когда» (очередь, лимит, отчёты), робот — «как» (браузер и hh). Одно действие за раз (src/lock.mjs).
//
//   GET  /ping                     жив ли процесс (healthcheck Docker), без токена
//   GET  /health                   браузер, вход в hh, занят ли, блок, счётчики «дня»
//   GET  /session                  cookie hh: имена и сроки, без значений
//   GET  /job                      фоновое задание (разведка): прогресс и итог
//   GET  /shots/<имя>.jpg          скриншот
//   POST /login                    открыть вход hh в окне робота («Общий экран» → vnc://localhost:5901)
//   POST /resume                   перепроверить вход и капчу, снять блок
//   POST /captcha {text}           ответ на капчу-картинку (фото в Telegram): ввести и отправить
//   POST /apply {vacancyId, letter, requestId, dry}   отклик; APPLY_LIVE=0 или dry: true — сухой прогон до кнопки
//   POST /recon {vacancyIds?, inbox?, resume?}   разведка без кликов — фоновое задание, 202 (resume — резюме, E0)
//   POST /resume/read {hash?}      резюме hh: поля из страницы резюме, только GET (часть D, S2); бэкап — /data/resume
//   POST /record {on}              запись: пользователь откликается сам в окне робота
//   POST /record/paste {text}      во время записи: вставить текст (письмо с Mac) туда, где курсор
//   POST /shot                     скриншот окна сейчас
//   POST /notice {key}             первый ли раз сообщают о key ({ first }) — одна тревога на блок при параллельных W9
//   POST /fake {outcomes}          только при APPLIER_FAKE=1: очередь исходов для проверки n8n (src/fake.mjs)
// Все адреса, кроме /ping, — с заголовком X-Applier-Token.
import { createReadStream, existsSync } from 'node:fs';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { Busy, lock } from './lock.mjs';
import { recallResult, rememberResult, store } from './store.mjs';
import { pause, prune, sleep } from './util.mjs';
import {
  SHOTS,
  SHOT_NAME,
  backupSession,
  browserStatus,
  cookies,
  ensure,
  launchedHoursAgo,
  recycle,
  role,
  shot,
  shotOf,
  shutdown,
} from './browser.mjs';
import { LOGIN_URL, SEL } from './hh/selectors.mjs';
import { applyFlow } from './flows/apply.mjs';
import { captchaKind, captchaShown, visible } from './flows/dom.mjs';
import { reconInbox, reconResume, reconVacancies } from './flows/recon.mjs';
import { readResume } from './flows/resume.mjs';
import { recordStart, recordStop, recording } from './flows/record.mjs';
import { FAKE_OUTCOMES, fakeApply, fakeCaptcha, fakePush, fakeQueue, fakeResume, fakeResumeRead } from './fake.mjs';

if (config.token.length < 16) {
  console.error('APPLIER_TOKEN не задан или короче 16 символов — без него API робота открыт, не стартую');
  process.exit(1);
}

class HttpError extends Error {
  constructor(code, body) {
    super(body?.error ?? String(code));
    this.code = code;
    this.body = body;
  }
}

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

function authorized(req) {
  const got = Buffer.from(String(req.headers['x-applier-token'] ?? ''));
  const want = Buffer.from(config.token);
  return got.length === want.length && timingSafeEqual(got, want);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new HttpError(413, { error: 'тело запроса больше 64 КБ' }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, { error: 'тело — не JSON' }));
      }
    });
    req.on('error', reject);
  });
}

// Блок (капча, выход из hh, лимит hh, сбои подряд): действия с hh — 423, пока его не снимут
function assertNotBlocked() {
  const blocked = store.blocked;
  if (blocked) throw new HttpError(423, { blocked });
}

// Фоновое задание (разведка): держит замок, прогресс — в GET /job
let job = null;
async function startJob(kind, run) {
  const release = await lock.hold(kind);
  job = { kind, state: 'running', startedAt: new Date().toISOString(), progress: null, result: null, error: null };
  const current = job;
  run((progress) => {
    current.progress = progress;
  })
    .then((result) => {
      current.result = result;
      current.state = 'done';
    })
    .catch((e) => {
      current.error = e.message.split('\n')[0];
      current.state = 'error';
      log('job.error', { kind, error: current.error });
    })
    .finally(() => {
      current.finishedAt = new Date().toISOString();
      release();
    });
  return current;
}

async function health() {
  const r = await role().catch(() => '');
  return {
    ok: true,
    api: 1,
    version: config.version,
    live: config.live,
    fake: config.fake,
    browser: browserStatus(),
    role: r,
    loggedIn: r === 'applicant',
    busy: Boolean(lock.current),
    by: lock.current?.name ?? null,
    job: job && { kind: job.kind, state: job.state, progress: job.progress, startedAt: job.startedAt },
    recording: recording(),
    blocked: store.blocked,
    today: store.today(),
    cap: config.dailyCap,
    lastApplyAt: store.lastApplyAt,
    lastInboxAt: store.lastInboxAt,
  };
}

const routes = {
  'GET /health': () => health(),

  'GET /session': async () => ({
    role: await role(),
    cookies: (await cookies()).map((c) => ({
      name: c.name,
      domain: c.domain,
      session: c.expires === -1,
      expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : null,
    })),
  }),

  'GET /job': () => job ?? { state: 'none' },

  'POST /login': () =>
    lock.run('login', async () => {
      const page = await ensure();
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return { ok: true, vnc: 'vnc://localhost:5901', note: 'Войдите в hh в окне робота, затем /resume' };
    }),

  // После «Общего экрана»: вошли → бэкап сессии и снять блок входа; капча пропала → снять блок капчи
  'POST /resume': () =>
    lock.run('resume', async () => {
      const page = await ensure();
      const loggedIn = (await role()) === 'applicant';
      if (loggedIn) await backupSession();
      const blocked = store.blocked;
      if (blocked?.kind === 'login' && loggedIn) store.unblock('вход восстановлен');
      if (['captcha', 'smart'].includes(blocked?.kind) && !(await captchaShown(page))) store.unblock('капча пройдена');
      if (blocked?.kind === 'errors') store.unblock('продолжить после сбоев');
      // «hh не принял отклик» (спам, правила): человек посмотрел аккаунт и нажал ▶️
      if (blocked?.kind === 'blocked') store.unblock('аккаунт проверен');
      if (!store.blocked) store.resetStreak();
      return { ok: true, loggedIn, blocked: store.blocked };
    }),

  // Ответ пользователя на фото капчи (W9 ← ответ в Telegram): ввести текст в форму /account/captcha и отправить.
  // 409 — капчи нет (блок сняли раньше: /go, «Общий экран»); не подошло — новая картинка { ok: false, shot }
  'POST /captcha': (body) =>
    lock.run(
      'captcha',
      async () => {
        const text = String(body.text ?? '').trim();
        if (!text) throw new HttpError(400, { ok: false, error: 'пустой ответ' });
        if (store.blocked?.kind !== 'captcha') throw new HttpError(409, { ok: false, error: 'капчи нет' });
        const page = await ensure();
        const input = page.locator(SEL.captchaInput).first();
        if (!(await visible(input))) {
          if (await captchaShown(page)) return { ok: false, error: 'на экране капча без поля для текста' };
          // Капчи на экране нет: решили в окне робота или страница ушла
          store.unblock('капчи на экране нет');
          return { ok: true, gone: true };
        }
        await input.fill(text);
        await pause(300, 800);
        const submit = page.locator(SEL.captchaSubmit).first();
        if (await visible(submit)) await submit.click({ timeout: 5000 });
        else await input.press('Enter');
        await page.waitForURL((u) => !/\/account\/captcha/.test(u.href), { timeout: 10000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await sleep(1000);
        const kind = await captchaKind(page);
        log('captcha.answer', { length: text.length, after: kind ?? 'none' });
        if (kind === 'captcha') {
          const name = await shotOf(page.locator(SEL.captchaForm), 'captcha');
          store.amend({ shot: name });
          return { ok: false, kind, shot: name };
        }
        if (kind === 'smart') {
          store.block('smart', { shot: await shot('smart') });
          return { ok: false, kind, error: 'hh показал капчу «Я не робот»' };
        }
        store.unblock('капча решена');
        return { ok: true };
      },
      { wait: 10000 },
    ),

  'POST /apply': async (body) => {
    const vacancyId = String(body.vacancyId ?? '').replace(/\D/g, '');
    if (!vacancyId) throw new HttpError(400, { error: 'нужен vacancyId' });
    const letter = String(body.letter ?? '');
    // CLI просит только сухой прогон — даже при APPLY_LIVE=1 (живой отклик — только из W9: он ведёт таблицу)
    const dry = body.dry === true;
    // Повтор после обрыва связи (деплой n8n, сон Mac): исход уже известен — не откликаемся второй раз
    const cached = recallResult(vacancyId);
    if (cached && cached.group === 'done') return { ...cached, cached: true };
    assertNotBlocked();
    // Потолок живых откликов за «день» робота — сверх лимита из настроек бота (его считает W9): защита от ошибки в n8n
    const today = store.today().applied;
    if (config.live && !dry && today >= config.dailyCap) {
      throw new HttpError(429, { error: `потолок дня робота: ${today} из ${config.dailyCap}`, today, cap: config.dailyCap });
    }
    const result = await lock.run('apply', () => applyFlow({ vacancyId, letter, dry }));
    rememberResult(vacancyId, result);
    return { ...result, requestId: body.requestId ?? null };
  },

  'POST /recon': async (body) => {
    assertNotBlocked();
    const ids = Array.isArray(body.vacancyIds) ? body.vacancyIds : [];
    if (!ids.length && !body.inbox && !body.resume) throw new HttpError(400, { error: 'нужны vacancyIds, inbox: true или resume: true' });
    const started = await startJob('recon', async (progress) => ({
      vacancies: ids.length ? await reconVacancies(ids, progress) : null,
      inbox: body.inbox ? await reconInbox(progress) : null,
      resume: body.resume ? await reconResume(progress) : null,
    }));
    return { status: 202, body: { ok: true, job: { kind: started.kind, state: started.state } } };
  },

  // Резюме hh для W13 (разделы резюме, сверка бота с hh). Капча — блок 423 на следующих действиях, как у отклика
  'POST /resume/read': async (body) => {
    assertNotBlocked();
    const hash = /^[0-9a-f]{32,64}$/.test(String(body.hash ?? '')) ? String(body.hash) : '';
    return lock.run('resume-read', () => readResume({ hash }));
  },

  'POST /record': async (body) => {
    if (body.on) {
      if (recording()) return { ok: true, recording: recording() };
      const release = await lock.hold('record');
      try {
        return { ok: true, recording: await recordStart(release) };
      } catch (e) {
        release();
        throw e;
      }
    }
    return { ok: true, stopped: await recordStop() };
  },

  // Мост буфера обмена на время записи: VNC передаёт только латиницу, а письмо русское. Текст с Mac (pbpaste) робот
  // вставляет в поле, где сейчас курсор, — отправляет по-прежнему человек. Без записи — 409
  'POST /record/paste': async (body) => {
    if (!recording()) throw new HttpError(409, { error: 'вставка — только во время записи (record start)' });
    const text = String(body.text ?? '');
    if (!text.trim()) throw new HttpError(400, { error: 'пустой текст' });
    const page = await ensure();
    await page.keyboard.insertText(text);
    log('record.paste', { length: text.length });
    return { ok: true, length: text.length };
  },

  'POST /shot': () => lock.run('shot', async () => ({ shot: await shot('manual') }), { wait: 5000 }),

  'POST /notice': (body) => noticeAck(body),
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://applier');
  if (req.method === 'GET' && url.pathname === '/ping') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (!authorized(req)) return send(res, 401, { error: 'нет или неверный X-Applier-Token' });

  const shotMatch = url.pathname.match(/^\/shots\/([^/]+)$/);
  if (req.method === 'GET' && shotMatch) {
    const name = shotMatch[1];
    const path = join(SHOTS, name);
    if (!SHOT_NAME.test(name) || !existsSync(path)) return send(res, 404, { error: 'нет такого скриншота' });
    res.writeHead(200, { 'content-type': name.endsWith('.png') ? 'image/png' : 'image/jpeg', 'cache-control': 'no-store' });
    return createReadStream(path).pipe(res);
  }

  if (config.fake) {
    const out = await fakeRoute(`${req.method} ${url.pathname}`, req).catch((e) => ({ status: e.code ?? 500, body: e.body ?? { error: e.message } }));
    return send(res, out.status, out.body);
  }
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: 'нет такого адреса' });
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await route(body);
    if (out && out.status && out.body) return send(res, out.status, out.body);
    return send(res, 200, out);
  } catch (e) {
    if (e instanceof Busy) return send(res, 409, { busy: true, by: e.by });
    if (e instanceof HttpError) return send(res, e.code, e.body);
    log('http.error', { path: url.pathname, error: e.message.split('\n')[0] });
    return send(res, 500, { error: e.message.split('\n')[0] });
  }
}

function noticeAck(body) {
  const key = String(body.key ?? '').slice(0, 100);
  if (!key) throw new HttpError(400, { error: 'нужен key' });
  return { first: store.ackNotice(key) };
}

// Фейковый режим (APPLIER_FAKE=1): браузера нет, исходы — по команде (src/fake.mjs)
async function fakeRoute(key, req) {
  const body = req.method === 'POST' ? await readBody(req) : {};
  switch (key) {
    case 'GET /health':
      return {
        status: 200,
        body: {
          ...(await health()),
          browser: { status: 'fake', since: null, guard: true },
          role: 'applicant',
          loggedIn: true,
          fake: true,
          fakeQueue: fakeQueue(),
        },
      };
    case 'POST /apply': {
      if (store.blocked) return { status: 423, body: { blocked: store.blocked } };
      const out = await lock.run('apply', () => fakeApply(body));
      return out.status === 200 ? { status: 200, body: { ...out.body, requestId: body.requestId ?? null } } : out;
    }
    case 'POST /captcha':
      return fakeCaptcha(body.text ?? '');
    case 'POST /resume':
      return { status: 200, body: fakeResume() };
    case 'POST /resume/read':
      if (store.blocked) return { status: 423, body: { blocked: store.blocked } };
      return { status: 200, body: fakeResumeRead() };
    case 'POST /notice':
      return { status: 200, body: noticeAck(body) };
    case 'POST /fake': {
      const outcomes = Array.isArray(body.outcomes) ? body.outcomes.map(String) : [];
      const out = fakePush(outcomes);
      return { status: out.ok ? 200 : 400, body: { ...out, known: FAKE_OUTCOMES } };
    }
    default:
      return { status: 501, body: { error: 'в фейковом режиме этого адреса нет', known: FAKE_OUTCOMES } };
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { error: e.message }));
});
// Отклик идёт до 3 минут: стандартные таймауты Node обрывали бы ответ
server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 60 * 1000;

server.listen(config.port, () => {
  log('start', { version: config.version, live: config.live, fake: config.fake, cap: config.dailyCap });
  if (!config.fake) ensure().catch(() => {}); // браузер — сразу, чтобы /health знал, вошли ли мы
});

// Обслуживание: раз в 10 минут — чистка скриншотов (14 дней) и журналов (30 дней), раз в час — бэкап сессии,
// раз в сутки в тихие часы (05:00–06:00 по местному) — перезапуск простаивающего браузера
let lastBackup = 0;
setInterval(async () => {
  prune(SHOTS, 14);
  prune(join(config.dataDir, 'logs'), 30);
  if (config.fake) return;
  if (Date.now() - lastBackup > 3600 * 1000 && !lock.current) {
    lastBackup = Date.now();
    await backupSession().catch(() => {});
  }
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: config.timezone, hour: '2-digit', hour12: false }));
  if (hour === 5 && launchedHoursAgo() > 20 && !lock.current) {
    await lock.run('recycle', () => recycle('раз в сутки')).catch(() => {});
  }
}, 10 * 60 * 1000).unref();

// Мягкая остановка: docker stop / пересоздание контейнера ждёт до 200 с (stop_grace_period) — доделываем
// текущее действие (≤ 180 с), сохраняем сессию и закрываем браузер
let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  log('stop', { signal, busy: lock.current?.name ?? null });
  server.close();
  await recordStop().catch(() => {});
  await lock.idle(180 * 1000);
  await shutdown();
  process.exit(0);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
