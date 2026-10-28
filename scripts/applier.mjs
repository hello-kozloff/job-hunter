#!/usr/bin/env node
// CLI робота-отклика (этап 6, docs/stages/stage-6.md). Робот — контейнер job-hunter-applier, API на 127.0.0.1:5682,
// токен — APPLIER_TOKEN из .env. Окно робота — «Общий экран» macOS: vnc://localhost:5901 (пароль VNC_PASSWORD).
//
//   node scripts/applier.mjs status [--cookies]      браузер, вход в hh, блок, занят ли (--cookies — имена и сроки)
//   node scripts/applier.mjs login                   открыть вход hh в окне робота и «Общий экран»; ждёт входа
//   node scripts/applier.mjs recon <id> [<id>…]      разведка вакансий без кликов → fixtures/applier/recon-…
//   node scripts/applier.mjs recon --inbox           разведка «Откликов» и чатов (чаты не открываются)
//   node scripts/applier.mjs recon --negotiations [--pages N]   все «Отклики» листанием, как человек (6–15 с между
//                                                    страницами): id вакансий и даты откликов → fixtures/applier/
//                                                    negotiations-…/topics.json для n8n-api.mjs hh-applied (docs/hh-applied.md)
//   node scripts/applier.mjs recon --chats <id> […]  чаты откликов (6.3a, напоминания): кликает «Чат» на странице
//                                                    вакансии и снимает, можно ли писать (поле, предупреждение,
//                                                    chat_data без текстов); ничего не вводит, «чат открыт» рвётся;
//                                                    чат с новыми сообщениями работодателя не открывает → fixtures/applier/chats-…
//   node scripts/applier.mjs recon --chooser <id>    окно отклика и выбор резюме (этап 5): открывает окно, нажимает на
//                                                    ячейку резюме и выбирает другое; «Откликнуться» не нажимает, ничего
//                                                    не отправляется (только вакансия, где hh покажет окно, не «в один
//                                                    клик») → fixtures/applier/chooser-…
//   node scripts/applier.mjs recon --resume          разведка резюме: «Мои резюме», резюме, страницы правки по ссылкам —
//                                                    без кликов, рвётся любой не-GET к hh (часть D, E0); бэкап резюме hh
//   node scripts/applier.mjs cv [hash]               прочитать резюме hh (только GET): должность, навыки, «О себе», опыт
//                                                    — сводка без личных данных; бэкап — /data/resume в томе робота
//   node scripts/applier.mjs cv-dry <файл.json>      сухой прогон записи резюме: робот заполняет формы hh и не сохраняет
//                                                    (всегда dry: true); файл — { hash?, changes: [{ kind: title | about |
//                                                    skills | place, … }] }; снимки форм — в fixtures/applier/
//   node scripts/applier.mjs search <адрес> […]       подборка hh «по резюме» (только GET, как W1): адреса
//                                                    https://hh.ru/search/vacancy?resume=<хеш>&… → сколько нашёл hh,
//                                                    сколько на странице, первые названия
//   node scripts/applier.mjs record start|stop       запись: вы откликаетесь сами в окне робота, он смотрит
//   node scripts/applier.mjs paste                   во время записи: буфер обмена Mac (pbpaste) → туда, где курсор
//                                                    в окне робота (VNC передаёт только латиницу, письмо — русское)
//   node scripts/applier.mjs apply <id> --letter-file <файл> [--resume <хеш>]   сухой прогон отклика: до кнопки, без
//                                                    клика (всегда — и при APPLY_LIVE=1: живой отклик только из W9, он
//                                                    ведёт таблицу); --resume — каким резюме hh откликнулся бы
//   node scripts/applier.mjs remind <id> [--text "…"]   сухой прогон напоминания (6.3): страница вакансии → можно ли
//                                                    напоминать → «Чат» → поле сообщения; текст не вводится, ничего не
//                                                    отправляется (всегда — и при REMIND_LIVE=1: живое только из W9)
//   node scripts/applier.mjs resume                  перепроверить вход и капчу, снять блок
//   node scripts/applier.mjs shot                    скриншот окна робота → fixtures/applier/
//   node scripts/applier.mjs fake <исход> […]        фейковый режим (APPLIER_FAKE=1): следующие исходы /apply по порядку
//                                                    (applied, applied_chat, already, test, external, hidden, archived,
//                                                    error, dry_run, captcha, smart, login, limit, busy, down, slow);
//                                                    /remind — с приставкой remind: (remind:sent, remind:viewed,
//                                                    remind:closed, remind:spam, remind:captcha, remind:busy …)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readEnv, local } from './lib/env.mjs';

const BASE = `http://127.0.0.1:${local().applierPort}`;
const VNC = `vnc://localhost:${readEnv().VNC_PORT || 5901}`;

const env = readEnv();
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
    const resume = args.includes('--resume');
    const chooserAt = args.indexOf('--chooser');
    const chooser = chooserAt >= 0 ? String(args[chooserAt + 1] ?? '').replace(/\D/g, '') : '';
    if (chooserAt >= 0 && !chooser) throw new Error('после --chooser нужен id вакансии hh');
    const negotiations = args.includes('--negotiations');
    const chatsMode = args.includes('--chats');
    const pagesAt = args.indexOf('--pages');
    const maxPages = pagesAt >= 0 ? Number(args[pagesAt + 1]) : 0;
    if (pagesAt >= 0 && !(maxPages > 0)) throw new Error('после --pages нужно число страниц');
    // Значения флагов — не id вакансий (без флага indexOf = -1: первый аргумент — id)
    const flagValue = new Set([chooserAt, pagesAt].filter((at) => at >= 0).map((at) => at + 1));
    const ids = args.filter((a, i) => /^\d+$/.test(a) && !flagValue.has(i));
    if (chatsMode && !ids.length) throw new Error('после --chats нужны id вакансий hh');
    if (!ids.length && !inbox && !resume && !chooser && !negotiations) {
      throw new Error('нужны id вакансий hh, --inbox, --resume, --negotiations, --chats <id…> или --chooser <id>');
    }
    // --chats: id — вакансии, чьи чаты открыть; без него — вакансии для разведки страниц
    await api('POST', '/recon', { vacancyIds: chatsMode ? [] : ids, chats: chatsMode ? ids : [], inbox, resume, chooser, negotiations, maxPages });
    console.log(
      `Разведка: ${[ids.length ? `${ids.length} ${chatsMode ? 'чатов откликов' : 'вакансий'} (20–40 с между ними)` : '', inbox ? 'отклики и чаты' : '', resume ? 'резюме (4–9 с между страницами)' : '', chooser ? `окно отклика вакансии ${chooser}` : '', negotiations ? `все отклики листанием${maxPages ? `, не больше ${maxPages} стр.` : ''} (6–15 с между страницами)` : ''].filter(Boolean).join(' + ')}…`,
    );
    const job = await waitJob();
    if (job.state === 'error') throw new Error(`разведка упала: ${job.error}`);
    const { vacancies, inbox: box, resume: cv, chooser: choice, negotiations: list, chats } = job.result;
    if (chats) {
      console.log(`→ ${chats.dir}`);
      for (const it of chats.items) {
        const t = it.topic;
        const head = `  ${it.id} ${it.facts?.title ? `«${it.facts.title}»` : ''}`;
        const topic = t ? `${t.lastState}${t.lastState === 'RESPONSE' ? (t.viewed ? ' · просмотрен' : ' · не просмотрен') : ''} · сообщений ${t.messages} · inbox ${t.inbox || '—'} · напомнить hh: ${t.reminderAllowed ? 'да' : 'нет'}` : 'отклика нет';
        console.log(`${head}\n     hh: ${topic} · вакансия: ${it.facts?.chatWrite || '—'}${it.facts?.archived ? ' · закрыта' : ''}`);
        if (it.stop || it.error || it.skipped) console.log(`     ${it.stop ? `⛔ ${it.stop}` : it.error ? `❌ ${it.error}` : `⏭ ${it.skipped}`}`);
        if (it.chat) {
          const w = it.chat.write;
          const mine = it.chat.messages.filter((m) => m.mine).length;
          const bots = it.chat.messages.filter((m) => m.bot).length;
          console.log(`     чат: писать ${w.allowed === true ? '✅ можно' : w.allowed === false ? `❌ нельзя (${[...w.reasons, ...w.disabledReasons].join(', ') || w.possibility})` : '?'} · сообщений ${it.chat.messages.length} (моих ${mine}, бота ${bots}) · напомнить hh: ${it.chat.reminderAllowed ?? '?'}`);
        } else if (it.frame) console.log('     чат: chat_data не поймал');
        if (it.input && !it.input.error) {
          const field = it.input.inputs.filter((x) => x.visible);
          console.log(`     поле ввода: ${field.length ? field.map((x) => `${x.tag}[${x.dataQa || '—'}]${x.disabled || x.readOnly ? ' неактивно' : ''}`).join(', ') : 'нет'}${it.input.warnings.length ? ` · предупреждения: ${it.input.warnings.map((x) => `«${x.label.slice(0, 80)}»`).join('; ')}` : ''}`);
        }
        if (it.ws?.length) console.log(`     WebSocket: ${it.ws.map((w) => `${w.url} (→${w.sent} ←${w.received})`).join(', ')}`);
        console.log(`     не-GET: ${it.posts?.length ?? 0}, порвано: ${it.blocked?.length ? [...new Set(it.blocked)].join(', ') : 0}${it.unread?.length > 1 ? ` · непрочитанные: ${JSON.stringify(it.unread[0])} → ${JSON.stringify(it.unread.at(-1))}` : ''}`);
      }
    }
    if (list) {
      console.log(`→ ${list.dir}/topics.json`);
      console.log(`  откликов на hh: ${list.total ?? '?'} (страниц ${list.pageCount ?? '?'}) · прочитано вакансий: ${list.read}, с датой: ${list.dated}`);
      for (const p of list.pages) console.log(`  стр. ${p.n}${p.again ? ' (ещё раз)' : ''}: ${p.topics} откликов из ${p.source}, ссылок в разметке ${p.dom}`);
      if (list.stop) console.log(`  ⛔ остановился: ${list.stop}`);
      const changed = list.countersAfter && JSON.stringify(list.countersBefore?.new) !== JSON.stringify(list.countersAfter?.new);
      console.log(`  счётчики «новых» до/после: ${JSON.stringify(list.countersBefore?.new ?? null)} / ${JSON.stringify(list.countersAfter?.new ?? null)}${changed ? ' ⚠️ ИЗМЕНИЛИСЬ' : ''}`);
      console.log(`  не-GET запросы страниц: ${list.requests.length}${list.requests.length ? `\n    ${[...new Set(list.requests)].join('\n    ')}` : ''}`);
      const c = list.census;
      if (c) {
        console.log(`  перепись: ${c.total} откликов — ${Object.entries(c.state).map(([k, n]) => `${k} ${n}`).join(', ')}`);
        const k = c.candidates;
        console.log(`  кандидаты в напоминание (ждёт ответа, не просмотрен, 3+ дня): ${k.total} — ${Object.entries(k.age).map(([a, n]) => `${a} ${n}`).join(', ')}`);
        for (const [chat, n] of Object.entries(k.chat).sort((a, b) => b[1] - a[1])) console.log(`    чат вакансии · топика: ${chat} — ${n}`);
        console.log(`    встроенное «напомнить» hh разрешено: ${k.reminderAllowed} · чат в архиве: ${k.chatArchived} · вакансия закрыта: ${k.closed}`);
      }
    }
    if (choice) {
      console.log(`→ ${choice.dir}`);
      if (choice.error || choice.skipped) console.log(`  ${choice.error ? `❌ ${choice.error}` : `⏭ ${choice.skipped}`}`);
      if (choice.prediction) console.log(`  прогноз hh: ${choice.prediction.type}`);
      if (choice.facts) console.log(`  резюме для отклика: свободных ${choice.facts.resumes.unused.length}, использованных ${choice.facts.resumes.used.length}, скрытых ${choice.facts.resumes.hidden.length}`);
      if (choice.modalOpened !== undefined) console.log(`  окно отклика: ${choice.modalOpened ? 'открылось' : 'не открылось'}; ячейка резюме: ${choice.cell ? 'есть' : 'нет'}`);
      if (choice.letterInput !== undefined) {
        console.log(`  поле письма: ${choice.letterInput ? 'есть' : 'нет'}${choice.letterToggle ? ' (после «Добавить сопроводительное»)' : ''}`);
      }
      for (const [tag, snap] of [['до', choice.before], ['после нажатия на резюме', choice.after]]) {
        if (!snap) continue;
        console.log(`  ${tag}: data-qa ${snap.dataQa.length}; окна: ${snap.dialogs.join(' | ') || '—'}`);
      }
      if (choice.pickedHash) {
        console.log(`  выбрал другое резюме (${choice.pickedHash.slice(0, 8)}…, в списке «${choice.optionTitle}»): в окне теперь «${choice.titleAfterPick}»; предупреждение о скрытом: ${choice.hiddenWarning ? 'показано' : 'нет'}; список закрылся: ${choice.optionStillThere ? 'нет' : 'да'}`);
      }
      console.log(`  порвано не-GET к hh: ${choice.blocked?.length ?? 0}${choice.blocked?.length ? `\n    ${choice.blocked.join('\n    ')}` : ''}`);
    }
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
    if (cv) {
      console.log(`→ ${cv.dir}`);
      console.log(`  резюме: ${cv.resumes.length}${cv.resumes.map((r) => `\n    ${r.hash.slice(0, 8)}… «${r.title || 'без названия'}» — ссылок на правку: ${r.editLinks?.length ?? 0}`).join('')}`);
      for (const r of cv.resumes) for (const l of r.editLinks ?? []) console.log(`      ${l}`);
      for (const p of cv.pages) {
        const flags = [p.captcha ? 'КАПЧА' : '', p.login ? 'НЕ ВОШЛИ' : ''].filter(Boolean).join(', ');
        console.log(
          `  ${p.name}: HTTP ${p.status}${flags ? ` ${flags}` : ''} · data-qa ${p.dataQa ?? 0} · полей ${p.fields ?? 0} (с пределом ${p.fieldLimits ?? 0}) · пределов в state ${Object.keys(p.limits ?? {}).length}${p.resumeKeys?.length ? ` · ключи ${p.resumeKeys.join(', ')}` : ''}`,
        );
      }
      console.log(`  порвано не-GET к hh: ${cv.blocked}${cv.blockedPaths?.length ? `\n    ${cv.blockedPaths.join('\n    ')}` : ''}`);
    }
  },

  async cv(args) {
    const hash = args.find((a) => /^[0-9a-f]{32,64}$/.test(a)) ?? '';
    console.log('Читаю резюме на hh (только чтение)…');
    const r = await api('POST', '/resume/read', { hash });
    if (!r.ok) throw new Error(`резюме не прочитал: ${r.error}`);
    for (const x of r.resumes) console.log(`  ${x.hash === r.resume.hash ? '→' : ' '} ${x.hash.slice(0, 8)}… «${x.title}» · ${x.access || '—'} · ${x.status}`);
    const v = r.resume;
    console.log(`должность: «${v.title}» (до ${v.limits.title} знаков)`);
    console.log(`«О себе»: ${v.about.length} знаков · ключевых навыков: ${v.keySkills.length} из ${v.limits.keySkills}`);
    for (const p of v.places) console.log(`💼 ${p.company} — ${p.position} (${p.start || '?'} — ${p.end || 'сейчас'}): ${p.description.length} знаков`);
    if (r.backup) console.log(`бэкап: /data/resume/${r.backup}`);
  },

  async search(args) {
    if (!args.length) throw new Error('search <адрес подборки hh по резюме> […]');
    console.log(`Читаю подборку hh по резюме (только чтение): ${args.length} стр.…`);
    const r = await api('POST', '/search', { urls: args, wait: 60000 });
    for (const x of r.results) {
      const q = new URL(x.url).searchParams;
      const what = `период ${q.get('search_period') ?? 'всё время'} · ${q.getAll('work_format').join(', ') || 'любой формат'} · стр. ${q.get('page') ?? 0}`;
      if (!x.ok) {
        console.log(`  ${what}: ❌ ${x.error}`);
        continue;
      }
      console.log(`  ${what}: hh нашёл ${x.total}, на странице ${x.vacancies.length}`);
      for (const v of x.vacancies.slice(0, 3)) console.log(`    ${v.vacancyId} «${v.name}» · ${v.publicationTime?.$?.slice(0, 10) ?? '?'}`);
    }
  },

  async 'cv-dry'(args) {
    if (!args[0]) throw new Error('cv-dry <файл.json> — { hash?, changes: [...] }');
    const job = JSON.parse(readFileSync(args[0], 'utf8'));
    let hash = job.hash;
    if (!hash) {
      const read = await api('POST', '/resume/read', {});
      if (!read.ok) throw new Error(`резюме не прочитал: ${read.error}`);
      hash = read.resume.hash;
    }
    console.log(`Сухой прогон записи: ${job.changes.length} разделов, резюме ${hash.slice(0, 8)}… (на hh ничего не сохраняется)`);
    // CLI никогда не просит живую запись: правка резюме — только из W13, где человек подтверждает каждый раздел
    const r = await api('POST', '/resume/write', { hash, changes: job.changes, dry: true });
    const dir = new URL('../fixtures/applier/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    for (const x of r.results) {
      let saved = '';
      if (x.shot) {
        writeFileSync(new URL(x.shot, dir), await api('GET', `/shots/${x.shot}`));
        saved = ` · fixtures/applier/${x.shot}`;
      }
      console.log(`  ${x.kind}${x.hhId ? ` ${x.hhId}` : ''}: ${x.outcome}${x.note ? ` — ${x.note}` : ''}${saved}`);
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
    // --resume <хеш резюме hh>: каким резюме откликнулся бы (проверка до клика: есть ли, не скрыто, не использовано)
    const j = args.indexOf('--resume');
    const hash = j >= 0 ? String(args[j + 1] ?? '') : '';
    if (j >= 0 && !/^[0-9a-f]{32,64}$/.test(hash)) throw new Error('после --resume нужен хеш резюме hh (его показывает node scripts/applier.mjs cv)');
    // CLI никогда не просит живой отклик (dry: true): иначе таблица n8n не узнала бы об отклике
    const r = await api('POST', '/apply', {
      vacancyId: id,
      letter: readFileSync(args[i + 1], 'utf8').trim(),
      requestId: `cli-${Date.now()}`,
      dry: true,
      ...(hash && { resume: { hash } }),
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

  async remind(args) {
    const id = args.find((a) => /^\d+$/.test(a));
    if (!id) throw new Error('remind <id вакансии hh> [--text "…"]');
    const at = args.indexOf('--text');
    const text = at >= 0 ? String(args[at + 1] ?? '') : 'Здравствуйте! Напоминаю про свой отклик.';
    console.log(`Сухой прогон напоминания ${id}: страница вакансии → чат → поле (текст не вводится)…`);
    const r = await api('POST', '/remind', { vacancyId: id, text, dry: true, requestId: `cli-${Date.now()}` });
    const hh = r.hh ? `${r.hh.lastState ?? '—'}${r.hh.viewed === true ? ' · просмотрен' : r.hh.viewed === false ? ' · не просмотрен' : ''} · вакансия ${r.hh.chatWrite || '—'}${r.hh.inbox ? ` · ${r.hh.inbox}` : ''}` : '—';
    console.log(`исход: ${r.outcome} (${r.group})${r.cached ? ' · из кэша' : ''}${r.note ? ` — ${r.note}` : ''}`);
    console.log(`hh: ${hh}${r.chatId ? ` · чат ${r.chatId}` : ''}`);
    if (r.shot) {
      const dir = new URL('../fixtures/applier/', import.meta.url);
      mkdirSync(dir, { recursive: true });
      writeFileSync(new URL(r.shot, dir), await api('GET', `/shots/${r.shot}`));
      console.log(`снимок: fixtures/applier/${r.shot}`);
    }
    console.log(`шаги: ${r.trace.map((t) => `${t.s}@${(t.ms / 1000).toFixed(1)}`).join(' → ')}`);
    if (r.pace?.nextAt) console.log(`пауза робота до ${r.pace.nextAt}`);
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
