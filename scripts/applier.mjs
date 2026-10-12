#!/usr/bin/env node
// CLI робота-отклика (этап 6, docs/stages/stage-6.md). Робот — контейнер job-hunter-applier, API на 127.0.0.1:5682,
// токен — APPLIER_TOKEN из .env. Окно робота — «Общий экран» macOS: vnc://localhost:5901 (пароль VNC_PASSWORD).
//
//   node scripts/applier.mjs status [--cookies]      браузер, вход в hh, блок, занят ли (--cookies — имена и сроки)
//   node scripts/applier.mjs login                   открыть вход hh в окне робота и «Общий экран»; ждёт входа
//   node scripts/applier.mjs recon <id> [<id>…]      разведка вакансий без кликов → fixtures/applier/recon-…
//   node scripts/applier.mjs recon --inbox           разведка «Откликов» и чатов (чаты не открываются)
//   node scripts/applier.mjs record start|stop       запись: вы откликаетесь сами в окне робота, он смотрит
//   node scripts/applier.mjs paste                   во время записи: буфер обмена Mac (pbpaste) → туда, где курсор
//                                                    в окне робота (VNC передаёт только латиницу, письмо — русское)
//   node scripts/applier.mjs apply <id> --letter-file <файл>   сухой прогон отклика: до кнопки, без клика (всегда —
//                                                    и при APPLY_LIVE=1: живой отклик только из W9, он ведёт таблицу)
//   node scripts/applier.mjs resume                  перепроверить вход и капчу, снять блок
//   node scripts/applier.mjs shot                    скриншот окна робота → fixtures/applier/
//   node scripts/applier.mjs fake <исход> […]        фейковый режим (APPLIER_FAKE=1): следующие исходы /apply по порядку
//                                                    (applied, applied_chat, already, test, external, hidden, archived,
//                                                    error, dry_run, captcha, smart, login, limit, busy, down, slow)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5682';
const VNC = 'vnc://localhost:5901';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    }),
);
if (!env.APPLIER_TOKEN) {
  console.error('В .env нет APPLIER_TOKEN — см. .env.example, раздел «Робот-отклик»');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'x-applier-token': env.APPLIER_TOKEN, ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(280000),
    });
  } catch (e) {
    console.error(`Робот не отвечает на ${BASE}: ${e.cause?.code ?? e.message}. Запуск: scripts/deploy.sh --applier`);
    process.exit(1);
  }
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (!res.ok && res.status !== 202) {
    const why =
      res.status === 409 ? `робот занят: ${data.by}` : res.status === 423 ? `блок: ${JSON.stringify(data.blocked)}` : JSON.stringify(data);
    console.error(`${method} ${path} → ${res.status}: ${why}`);
    process.exit(1);
  }
  return data;
}

function printHealth(h) {
  console.log(`браузер: ${h.browser.status}${h.browser.guard ? ' · предохранитель включён' : ' · предохранитель ВЫКЛЮЧЕН'}`);
  console.log(`hh: ${h.loggedIn ? '✅ вошли (applicant)' : `🔑 не вошли (hhrole=${h.role || '—'})`}`);
  console.log(`режим: ${h.fake ? 'фейк' : h.live ? 'боевой (APPLY_LIVE=1)' : 'сухой прогон (APPLY_LIVE=0)'} · версия ${h.version}`);
  console.log(`занят: ${h.busy ? h.by : 'нет'}${h.recording ? ` · идёт запись → ${h.recording.dir}` : ''}`);
  if (h.job) console.log(`задание: ${h.job.kind} — ${h.job.state} ${h.job.progress ? JSON.stringify(h.job.progress) : ''}`);
  console.log(`блок: ${h.blocked ? `${h.blocked.kind} с ${h.blocked.since}` : 'нет'}`);
  console.log(`сегодня: ${h.today.applied ?? 0} откликов, ${h.today.errors ?? 0} сбоев (потолок ${h.cap})`);
}

async function waitJob() {
  let last = '';
  for (;;) {
    const job = await api('GET', '/job');
    if (job.state !== 'running') return job;
    const p = job.progress;
    const line = p?.total ? `  вакансия ${p.done + 1} из ${p.total}: ${p.current}` : p?.step ? `  ${p.step}` : '';
    if (line && line !== last) console.log((last = line));
    await sleep(5000);
  }
}

const commands = {
  async status(args) {
    printHealth(await api('GET', '/health'));
    if (args.includes('--cookies')) {
      const s = await api('GET', '/session');
      for (const c of s.cookies) console.log(`  ${c.name} (${c.domain}) ${c.session ? 'сессионная' : `до ${c.expires}`}`);
    }
  },

  async login() {
    await api('POST', '/login');
    console.log(`Окно робота открыто на странице входа hh. «Общий экран»: ${VNC} (пароль — VNC_PASSWORD из .env).`);
    console.log('Войдите по телефону и коду, как обычно. Жду до 10 минут…');
    try {
      execFileSync('open', [VNC]);
    } catch {
      // не macOS или нет «Общего экрана» — откроете сами
    }
    for (let i = 0; i < 120; i++) {
      const h = await api('GET', '/health');
      if (h.loggedIn) {
        const r = await api('POST', '/resume');
        console.log(`✅ Вошли. Сессия сохранена${r.blocked ? `, но есть блок: ${r.blocked.kind}` : ''}.`);
        return;
      }
      await sleep(5000);
    }
    console.error('За 10 минут вход не случился. Повторите: node scripts/applier.mjs login');
    process.exit(1);
  },

  async recon(args) {
    const inbox = args.includes('--inbox');
    const ids = args.filter((a) => /^\d+$/.test(a));
    if (!ids.length && !inbox) throw new Error('нужны id вакансий hh или --inbox');
    await api('POST', '/recon', { vacancyIds: ids, inbox });
    console.log(`Разведка: ${ids.length ? `${ids.length} вакансий (20–40 с между ними)` : ''}${inbox ? ' + отклики и чаты' : ''}…`);
    const job = await waitJob();
    if (job.state === 'error') throw new Error(`разведка упала: ${job.error}`);
    const { vacancies, inbox: box } = job.result;
    if (vacancies) {
      console.log(`→ ${vacancies.dir}`);
      for (const it of vacancies.items) {
        if (it.error) {
          console.log(`  ${it.id}: ❌ ${it.error}`);
          continue;
        }
        const f = it.facts;
        const flags = [
          f.archived || f.closed ? 'закрыта' : '',
          f.applied ? 'уже откликались' : '',
          f.hasTests ? 'тест' : '',
          f.letterRequired ? 'письмо обязательно' : '',
          f.country && f.country !== 'RU' ? f.country : '',
          it.captcha ? 'КАПЧА' : '',
        ].filter(Boolean);
        const shown = Object.entries(it.dom ?? {})
          .filter(([, v]) => v.visible)
          .map(([k]) => k);
        console.log(`  ${it.id} HTTP ${it.status} ${f.loggedIn ? '' : '[не вошли] '}${f.title} — ${flags.join(', ') || 'обычная'}`);
        console.log(`     видно: ${shown.join(', ') || '—'}; popup: ${JSON.stringify(it.popup?.prediction ?? it.popup?.status ?? null)}; webdriver=${it.webdriver}`);
      }
    }
    if (box) {
      console.log(`→ ${box.dir}`);
      console.log(`  отклики: HTTP ${box.negotiations.status}, тем ${box.negotiations.topics}, ключи: ${box.negotiations.keys.join(', ')}`);
      console.log(`  чаты: HTTP ${box.chats.status}${box.chats.error ? ` (${box.chats.error})` : ''}`);
      console.log(`  непрочитанные до/после: ${JSON.stringify(box.unread.before)} / ${JSON.stringify(box.unread.after)}${box.unreadChanged ? ' ⚠️ ИЗМЕНИЛИСЬ' : ''}`);
    }
  },

  async record(args) {
    if (args[0] === 'start') {
      const r = await api('POST', '/record', { on: true });
      console.log(`Запись идёт → ${r.recording.dir}`);
      console.log(`Откликнитесь сами в окне робота («Общий экран»: ${VNC}), потом: node scripts/applier.mjs record stop`);
      try {
        execFileSync('open', [VNC]);
      } catch {
        // откроете сами
      }
    } else if (args[0] === 'stop') {
      const r = await api('POST', '/record', { on: false });
      console.log(r.stopped ? `Запись остановлена: ${r.stopped.snapshots} экранов, ${r.stopped.xhr} ответов hh → ${r.stopped.dir}` : 'Запись не шла');
    } else throw new Error('record start | record stop');
  },

  async apply(args) {
    const id = args.find((a) => /^\d+$/.test(a));
    const i = args.indexOf('--letter-file');
    if (!id || i < 0 || !args[i + 1]) throw new Error('apply <id вакансии hh> --letter-file <файл с письмом>');
    // CLI никогда не просит живой отклик (dry: true): иначе таблица n8n не узнала бы об отклике
    const r = await api('POST', '/apply', {
      vacancyId: id,
      letter: readFileSync(args[i + 1], 'utf8').trim(),
      requestId: `cli-${Date.now()}`,
      dry: true,
    });
    console.log(`${r.outcome} (${r.group}) за ${Math.round(r.ms / 1000)} с${r.note ? ` — ${r.note}` : ''}${r.shot ? ` · скриншот ${r.shot}` : ''}`);
    for (const t of r.trace ?? []) console.log(`  ${t.ms} мс  ${t.s} ${JSON.stringify({ ...t, s: undefined, ms: undefined })}`);
  },

  async paste() {
    // Текст — из pipe или из буфера обмена Mac: скопировали письмо в Telegram → кликнули в поле в окне робота → paste
    let text = '';
    if (!process.stdin.isTTY) text = readFileSync(0, 'utf8');
    if (!text.trim()) text = execFileSync('pbpaste', { encoding: 'utf8' });
    if (!text.trim()) throw new Error('буфер обмена пуст — скопируйте письмо в Telegram');
    const r = await api('POST', '/record/paste', { text: text.trim() });
    console.log(`Вставлено ${r.length} знаков туда, где курсор в окне робота`);
  },

  async resume() {
    const r = await api('POST', '/resume');
    console.log(`вошли: ${r.loggedIn ? 'да' : 'нет'} · блок: ${r.blocked ? r.blocked.kind : 'нет'}`);
  },

  async fake(args) {
    if (!args.length) throw new Error('fake <исход> […] — список: node scripts/applier.mjs fake help');
    if (args[0] === 'help') {
      const h = await api('GET', '/health');
      console.log(`Фейковый режим: ${h.fake ? 'вкл' : 'ВЫКЛ (APPLIER_FAKE=1 в .env → scripts/deploy.sh --applier)'}; очередь: ${(h.fakeQueue ?? []).join(', ') || '—'}`);
      return;
    }
    const r = await api('POST', '/fake', { outcomes: args });
    console.log(`Очередь исходов: ${r.queue.join(', ')}`);
  },

  async shot() {
    const { shot } = await api('POST', '/shot');
    const jpg = await api('GET', `/shots/${shot}`);
    const dir = new URL('../fixtures/applier/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(shot, dir), jpg);
    console.log(`fixtures/applier/${shot}`);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!commands[cmd]) {
  console.error(`Команды: ${Object.keys(commands).join(', ')} — подробно в начале scripts/applier.mjs`);
  process.exit(2);
}
try {
  await commands[cmd](args);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
