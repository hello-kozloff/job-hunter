// Браузер робота: Chromium с окном в виртуальном экране (Xvfb), постоянный профиль /data/profile — вход в hh
// сохраняется между запусками. Одна вкладка. Окно видно через «Общий экран» macOS: vnc://localhost:5901.
// Без маскировки: обычный Chromium из образа Playwright (решение 10.10.2026; разведка пишет navigator.webdriver).
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { FORCE_QUICK, FORCE_QUICK_URL, GUARD_URL, HH, RESPONSE_PAGE } from './hh/selectors.mjs';
import { roleFromCookies } from './hh/state.mjs';
import { stamp, writeJsonAtomic } from './util.mjs';

const PROFILE = join(config.dataDir, 'profile');
const STORAGE = join(config.dataDir, 'storage.json');
export const SHOTS = join(config.dataDir, 'shots');

let context = null;
let page = null;
let starting = null;
let status = 'down';
let launchedAt = 0;
// Сетевой предохранитель включён по умолчанию; выключают только запись (человек откликается сам) и живой отклик
let guardOn = true;

export const browserStatus = () => ({
  status,
  since: launchedAt ? new Date(launchedAt).toISOString() : null,
  guard: guardOn,
});
export const launchedHoursAgo = () => (launchedAt ? (Date.now() - launchedAt) / 3600000 : 0);

export function setGuard(on) {
  if (guardOn === Boolean(on)) return;
  guardOn = Boolean(on);
  log('guard', { on: guardOn });
}

async function launch() {
  status = 'starting';
  mkdirSync(PROFILE, { recursive: true });
  context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: null,
    locale: config.locale,
    timezoneId: config.timezone,
    acceptDownloads: false,
    args: ['--window-position=0,0', '--window-size=1600,1000', `--lang=${config.locale}`],
  });
  context.setDefaultTimeout(20000);
  context.on('close', () => {
    status = 'down';
    context = null;
    page = null;
    log('browser.closed');
  });
  // Предохранитель: всё, что может изменить аккаунт, — не-GET к /applicant/…, /shards/applicant/… и chatik.
  // GET ничего не отправляет (отклик — POST): переход на страницу отклика hh делает и сам — у вакансии с тестом
  // (разведка 10.10.2026), его только пишем в журнал. Перехватываем только эти адреса — кэш остальных не трогаем
  await context.route(GUARD_URL, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (guardOn && req.method() !== 'GET') {
      log('guard.blocked', { method: req.method(), path });
      return route.abort('blockedbyclient');
    }
    if (req.resourceType() === 'document' && RESPONSE_PAGE.test(req.url())) log('nav.response_page', { path });
    return route.continue();
  });
  // Переход на /vacancy/<id>?forceQuickResponse=true — страница сама отправит отклик «в один клик»
  await context.route(FORCE_QUICK_URL, (route) => {
    const req = route.request();
    if (guardOn && req.resourceType() === 'document' && FORCE_QUICK.test(req.url())) {
      log('guard.blocked', { method: req.method(), path: new URL(req.url()).pathname, force: 'quickResponse' });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page = context.pages()[0] ?? (await context.newPage());
  await restoreSession();
  status = 'up';
  launchedAt = Date.now();
  log('browser.up', { role: await role() });
}

// Живая вкладка браузера; упал — поднимаем заново
export async function ensure() {
  if (context && page && !page.isClosed()) return page;
  if (!starting) {
    starting = (context ? Promise.resolve() : launch())
      .catch((e) => {
        status = 'down';
        log('browser.error', { error: e.message.split('\n')[0] });
        throw e;
      })
      .finally(() => {
        starting = null;
      });
  }
  await starting;
  if (!page || page.isClosed()) page = await context.newPage();
  return page;
}

export const browserContext = () => context;
export const cookies = async () => (context ? context.cookies(HH) : []);
export const role = async () => roleFromCookies(await cookies());

// Сессионные cookie (без срока) Chromium между запусками не хранит → бэкап storageState (права 600)
// после входа и раз в час, восстановление при старте, если вход пропал
export async function backupSession() {
  if (!context || (await role()) !== 'applicant') return false;
  writeJsonAtomic(STORAGE, await context.storageState());
  return true;
}

async function restoreSession() {
  if ((await role()) === 'applicant' || !existsSync(STORAGE)) return;
  try {
    const saved = JSON.parse(readFileSync(STORAGE, 'utf8'));
    const hh = (saved.cookies ?? []).filter((c) => /(^|\.)hh\.ru$/.test(String(c.domain).replace(/^\./, '')));
    if (!hh.length) return;
    await context.addCookies(hh);
    log('session.restored', { cookies: hh.length, role: await role() });
  } catch (e) {
    log('session.restore_error', { error: e.message });
  }
}

// Перезапуск браузера (раз в сутки в тихие часы: Chromium копит память)
export async function recycle(reason) {
  if (!context) return;
  await backupSession().catch(() => {});
  log('browser.recycle', { reason });
  await context.close().catch(() => {});
  context = null;
  page = null;
  await ensure();
}

export async function shutdown() {
  await backupSession().catch(() => {});
  await context?.close().catch(() => {});
}

// Скриншот видимой части окна: JPEG q70 — Telegram не принимает длинные картинки во всю страницу
export const SHOT_NAME = /^\d{8}-\d{6}-[a-z0-9-]+\.jpg$/;
export async function shot(tag, dir = SHOTS) {
  const p = await ensure();
  mkdirSync(dir, { recursive: true });
  const slug = String(tag).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'shot';
  const name = `${stamp()}-${slug}.jpg`;
  await p.screenshot({ path: join(dir, name), type: 'jpeg', quality: 70 });
  return name;
}
