// Браузер робота: Chromium с окном в виртуальном экране (Xvfb), постоянный профиль /data/profile — вход в hh
// сохраняется между запусками. Одна вкладка. Окно видно через «Общий экран» macOS: vnc://localhost:5901.
// Без маскировки: обычный Chromium из образа Playwright (решение 10.10.2026; разведка пишет navigator.webdriver).
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { FORCE_QUICK, FORCE_QUICK_URL, GUARD_ALLOW, GUARD_URL, HH, HH_PAGE, RESPONSE_PAGE } from './hh/selectors.mjs';
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
// Сетевой предохранитель включён по умолчанию; выключает только запись (человек откликается сам). Живой отклик
// его не выключает, а открывает по одному действию (guardAllow): всё остальное, что может изменить аккаунт, рвётся
let guardOn = true;
let allowed = new Set();

export const browserStatus = () => ({
  status,
  since: launchedAt ? new Date(launchedAt).toISOString() : null,
  guard: guardOn,
  allowed: [...allowed],
});
export const launchedHoursAgo = () => (launchedAt ? (Date.now() - launchedAt) / 3600000 : 0);

export function setGuard(on) {
  if (guardOn === Boolean(on)) return;
  guardOn = Boolean(on);
  log('guard', { on: guardOn });
}

// Живой отклик: открыть действия по именам (hh/selectors.mjs → GUARD_ALLOW, quick — переход forceQuickResponse).
// Сценарий открывает их по мере шагов и закрывает все в конце (guardReset)
export function guardAllow(...names) {
  for (const name of names) allowed.add(name);
  log('guard.allow', { names: [...allowed] });
}
export function guardReset() {
  if (!allowed.size) return;
  allowed = new Set();
  log('guard.reset');
}
const isAllowed = (url) => [...allowed].some((name) => (GUARD_ALLOW[name] ?? []).some((re) => re.test(url)));

// Рвать ли запрос: не-GET к адресам, которые могут изменить аккаунт (кроме открытых действий), и переход на
// ?forceQuickResponse=true (без открытого quick). Отдельной функцией — её же зовёт симуляция отклика (applier/sim)
export function guardBlocks(req) {
  if (!guardOn) return false;
  const url = req.url();
  const write = req.method() !== 'GET' && GUARD_URL.test(url) && !isAllowed(url);
  const quick = req.resourceType() === 'document' && FORCE_QUICK_URL.test(url) && FORCE_QUICK.test(url) && !allowed.has('quick');
  if (!write && !quick) return false;
  log('guard.blocked', { method: req.method(), path: new URL(url).pathname, ...(quick && { force: 'quickResponse' }) });
  return true;
}

// Строгий предохранитель (разведка резюме, E0 15.10.2026): рвём любой не-GET к hh, не только к /applicant/ — как
// hh сохраняет резюме, ещё неизвестно. Каждый порванный — в onBlocked (так видно, что страницы шлют сами).
// Свой маршрут поверх остальных (Playwright зовёт маршруты от последнего к первому), GET уходит дальше — к обычному
// предохранителю. Вернуть как было — вызвать результат
export async function strictGuard(onBlocked = () => {}) {
  if (!context) throw new Error('браузер не запущен');
  const ctx = context;
  const handler = (route) => {
    const req = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.fallback();
    const path = new URL(req.url()).pathname;
    onBlocked({ method: req.method(), host: new URL(req.url()).hostname, path, type: req.resourceType() });
    log('guard.strict', { method: req.method(), path });
    return route.abort('blockedbyclient');
  };
  await ctx.route(HH_PAGE, handler);
  log('guard.strict', { on: true });
  return async () => {
    await ctx.unroute(HH_PAGE, handler).catch(() => {});
    log('guard.strict', { on: false });
  };
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
    if (guardBlocks(req)) return route.abort('blockedbyclient');
    if (req.resourceType() === 'document' && RESPONSE_PAGE.test(req.url())) {
      log('nav.response_page', { path: new URL(req.url()).pathname });
    }
    return route.continue();
  });
  // Переход на /vacancy/<id>?forceQuickResponse=true — страница сама отправит отклик «в один клик»
  await context.route(FORCE_QUICK_URL, (route) =>
    guardBlocks(route.request()) ? route.abort('blockedbyclient') : route.continue(),
  );
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
export const SHOT_NAME = /^\d{8}-\d{6}-[a-z0-9-]+\.(jpg|png)$/;
const shotName = (tag) =>
  `${stamp()}-${String(tag).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'shot'}.jpg`;
// fullPage — вся страница целиком (разведка: страница резюме длинная), для Telegram не годится
export async function shot(tag, dir = SHOTS, { fullPage = false } = {}) {
  const p = await ensure();
  mkdirSync(dir, { recursive: true });
  const name = shotName(tag);
  await p.screenshot({ path: join(dir, name), type: 'jpeg', quality: 70, fullPage });
  return name;
}

// Снимок одного элемента (картинка капчи для Telegram — крупно); не вышло — всё окно
export async function shotOf(locator, tag) {
  mkdirSync(SHOTS, { recursive: true });
  const name = shotName(tag);
  try {
    await locator.screenshot({ path: join(SHOTS, name), type: 'jpeg', quality: 85, timeout: 5000 });
    return name;
  } catch {
    return shot(tag);
  }
}
