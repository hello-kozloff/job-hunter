// Запись (этап 6.0): пользователь сам откликается в окне робота через «Общий экран», робот только смотрит —
// так видно экраны hh ПОСЛЕ нажатия «Откликнуться» (окно с письмом, один клик, «другая страна», чат), которые
// разведка без клика не увидит. Предохранитель выключен (отклик человека должен уйти), замок держится до stop.
// Каждая смена набора видимых data-qa → снимок: html, dom.json, shot.jpg; ответы XHR hh по отклику и чатам → .txt.
// С 15.10.2026 (часть D «Экспорт на hh», E0) так же записываются правки резюме: что пишем — hh/resume.mjs → recordWanted.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browserContext, ensure, setGuard, shot } from '../browser.mjs';
import { log } from '../log.mjs';
import { recordWanted } from '../hh/resume.mjs';
import { WATCH } from '../hh/selectors.mjs';
import { stamp } from '../util.mjs';
import { RECON_DIR } from './recon.mjs';
import { visibleDataQa, watchSelectors } from './dom.mjs';

let rec = null;

const slug = (s) => String(s).replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 60);

export const recording = () =>
  rec ? { dir: rec.dir, since: rec.since, snapshots: rec.snapshots, xhr: rec.xhr } : null;

export async function recordStart(release) {
  if (rec) return recording();
  const page = await ensure();
  const name = `record-${stamp()}`;
  const dir = join(RECON_DIR, name);
  mkdirSync(dir, { recursive: true });
  rec = { dir: `fixtures/applier/${name}`, path: dir, since: new Date().toISOString(), snapshots: 0, xhr: 0, seq: 0, sig: '', release };
  setGuard(false);
  const next = () => String(++rec.seq).padStart(3, '0');

  rec.onResponse = async (response) => {
    const req = response.request();
    if (!['xhr', 'fetch', 'document'].includes(req.resourceType()) || !recordWanted(req.method(), response.url())) return;
    let body = '';
    try {
      body = (await response.text()).slice(0, 200000);
    } catch {
      // тело недоступно (редирект) — пишем без него
    }
    if (!rec) return;
    const text = [
      `${req.method()} ${response.url()}`,
      `status ${response.status()}`,
      '',
      req.postData() ?? '',
      '',
      body,
    ].join('\n');
    writeFileSync(join(rec.path, `${next()}-xhr-${req.method()}${slug(response.url())}.txt`), text);
    rec.xhr++;
  };
  rec.onPage = (p) => {
    log('record.page', { url: p.url() });
    if (rec) writeFileSync(join(rec.path, `${next()}-new-window.txt`), p.url());
  };
  const ctx = browserContext();
  ctx.on('response', rec.onResponse);
  ctx.on('page', rec.onPage);

  // Раз в секунду: сменился набор видимых data-qa (по всем кадрам — чат hh в iframe) → снимок экрана
  rec.timer = setInterval(async () => {
    if (!rec || rec.busy) return;
    rec.busy = true;
    try {
      const frames = page.frames();
      const lists = await Promise.all(frames.map((f) => visibleDataQa(f).catch(() => [])));
      const sig = `${page.url()}|${lists.map((l) => l.join(',')).join('|')}`;
      if (sig !== rec.sig) {
        rec.sig = sig;
        const n = next();
        const watch = await watchSelectors(page, WATCH).catch(() => ({}));
        writeFileSync(
          join(rec.path, `${n}-dom.json`),
          JSON.stringify({ url: page.url(), frames: frames.map((f) => f.url()), visible: lists, watch }, null, 2),
        );
        writeFileSync(join(rec.path, `${n}-page.html`), await page.content().catch(() => ''));
        await shot(`${n}`, rec.path);
        rec.snapshots++;
      }
    } catch (e) {
      log('record.error', { error: e.message.split('\n')[0] });
    } finally {
      if (rec) rec.busy = false;
    }
  }, 1000);
  log('record.start', { dir: rec.dir });
  return recording();
}

export async function recordStop() {
  if (!rec) return null;
  clearInterval(rec.timer);
  const ctx = browserContext();
  ctx?.off('response', rec.onResponse);
  ctx?.off('page', rec.onPage);
  const info = recording();
  setGuard(true);
  rec.release?.();
  rec = null;
  log('record.stop', info);
  return info;
}
