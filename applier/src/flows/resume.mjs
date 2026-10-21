// Резюме hh (часть D; docs/recommendations.md → «Разделы резюме», «Выгрузка на hh»).
// Чтение (S2): «Мои резюме» → страница резюме → поля из InitialState (applicantResume). Без кликов, только GET:
// строгий предохранитель рвёт любой не-GET к hh (как разведка резюме, E0). Прочитанное резюме целиком — бэкап в
// /data/resume (30 дней): до записи на hh есть что вернуть.
// Запись (E2/E3): каждый раздел — своей формой hh, как человек (в теле сохранения — отпечатки браузера). Сухая —
// заполнить, снимок, уйти без сохранения (сохранение рвёт и предохранитель); живая (RESUME_LIVE=1) — открыть одно
// действие предохранителя (resume | profile), «Сохранить», ответ hh, закрыть; в конце — чтение для сверки.
import { join } from 'node:path';
import { config } from '../config.mjs';
import { SHOTS, ensure, guardAllow, guardReset, setGuard, shot, strictGuard } from '../browser.mjs';
import { log } from '../log.mjs';
import { store } from '../store.mjs';
import { RESUMES_URL, cvFormUrl, parseResume, pickResume, resumeList, resumeUrl, skillsDiff, writeResult } from '../hh/resume.mjs';
import { SEL } from '../hh/selectors.mjs';
import { initialState, isCaptchaPage, isLoginUrl, redactState } from '../hh/state.mjs';
import { sameText } from '../hh/xhr.mjs';
import { pause, prune, stamp, writeJsonAtomic } from '../util.mjs';
import { captchaShown, visible, visibleWithin } from './dom.mjs';
import { watchActions } from './net.mjs';

export const RESUME_DIR = join(config.dataDir, 'resume');

// Страница hh → { state } или { error: captcha | login | layout }. Капча — блок, как у отклика: дальше решает человек.
// Общая с подборкой по резюме (flows/search.mjs); tag — имя снимка капчи
export async function openState(page, url, tag = 'captcha-resume') {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const html = (await res?.text().catch(() => '')) ?? '';
  if (isCaptchaPage(page.url(), html) || (await captchaShown(page))) {
    store.block('captcha', { shot: await shot(tag) });
    return { error: 'captcha' };
  }
  const state = initialState(html);
  if (isLoginUrl(page.url()) || (state?.userType && state.userType !== 'applicant')) return { error: 'login' };
  return state ? { state } : { error: 'layout' };
}

// → { ok: true, resumes, resume, backup } или { ok: false, error: captcha | login | layout | no_resume | not_found, resumes? }
export async function readResume({ hash = '' } = {}) {
  const page = await ensure();
  setGuard(true);
  const relax = await strictGuard();
  try {
    const list = await openState(page, RESUMES_URL);
    if (list.error) return { ok: false, error: list.error };
    const resumes = resumeList(list.state);
    const pick = pickResume(resumes, hash);
    if (!pick) return { ok: false, error: hash ? 'not_found' : 'no_resume', resumes };
    await pause(3000, 6000);
    const view = await openState(page, resumeUrl(pick.hash));
    if (view.error) return { ok: false, error: view.error, resumes };
    const resume = parseResume(view.state.applicantResume);
    if (!resume) return { ok: false, error: 'layout', resumes };
    prune(RESUME_DIR, 30);
    const backup = `${pick.hash.slice(0, 8)}-${stamp()}.json`;
    writeJsonAtomic(join(RESUME_DIR, backup), { at: new Date().toISOString(), resume: redactState(view.state).applicantResume });
    log('resume.read', { hash: pick.hash.slice(0, 8), places: resume.places.length, keySkills: resume.keySkills.length });
    return { ok: true, resumes, resume, backup };
  } finally {
    await relax();
  }
}

// ---------- Запись ----------

// Страница формы → {} или { error: captcha | login }
async function openForm(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (await captchaShown(page)) {
    store.block('captcha', { shot: await shot('captcha-resume') });
    return { error: 'captcha' };
  }
  if (isLoginUrl(page.url())) return { error: 'login' };
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  return {};
}

// Поле формы: заполнить и проверить, что значение встало. combo — поле с подсказками hh: Escape закрывает список.
// → 'ok' | 'same' | причина
async function setField(page, selector, value, combo = false) {
  const input = page.locator(selector).first();
  if (!(await visibleWithin(input, 15000))) return 'нет поля на странице';
  if (sameText(await input.inputValue(), value)) return 'same';
  await input.click({ timeout: 5000 }).catch(() => {});
  await pause(300, 700);
  await input.fill(value);
  if (combo) await page.keyboard.press('Escape').catch(() => {});
  await pause(500, 1000);
  return sameText(await input.inputValue(), value) ? 'ok' : 'значение не встало в поле';
}

async function fillFields(page, c) {
  const fields =
    c.kind === 'title'
      ? [[SEL.cvTitle, c.value, true]]
      : c.kind === 'about'
        ? [[SEL.cvAbout, c.value, false]]
        : [
            [SEL.cvPlacePosition, c.position, true],
            [SEL.cvPlaceDescription, c.description, false],
          ].filter(([, v]) => typeof v === 'string');
  let changed = false;
  for (const [selector, value, combo] of fields) {
    const r = await setField(page, selector, value, combo);
    if (r === 'same') continue;
    if (r !== 'ok') return { error: r };
    changed = true;
  }
  return changed ? {} : { same: true };
}

// Ключевые навыки: «чипсы» на странице → убрать лишние (крестик), добавить новые (поле → «добавить как написано»).
// Сначала убираем: больше 30 hh не даст
const chipName = (q) => String(q ?? '').replace(/^chips-trigger-chip-/, '');
const cssAttr = (s) => String(s).replace(/["\\]/g, '\\$&');
async function fillSkills(page, target) {
  const input = page.locator(SEL.cvSkillInput).first();
  if (!(await visibleWithin(input, 15000))) return { error: 'нет поля навыков' };
  const chips = async () => (await page.locator(SEL.cvSkillChip).evaluateAll((els) => els.map((e) => e.getAttribute('data-qa')))).map(chipName);
  const { remove, add } = skillsDiff(await chips(), target);
  if (!remove.length && !add.length) return { same: true };
  for (const name of remove) {
    const del = page.locator(`[data-qa="chips-trigger-chip-${cssAttr(name)}"] ${SEL.cvSkillDelete}`).first();
    if (!(await visible(del))) return { error: `не нашёл на hh навык «${name}»` };
    await del.click({ timeout: 5000 });
    await pause(300, 800);
  }
  for (const name of add) {
    await input.click({ timeout: 5000 });
    await input.fill(name);
    const item = page.locator(SEL.cvSkillUserItem).first();
    if (!(await visibleWithin(item, 6000))) return { error: `hh не предложил добавить «${name}»` };
    await pause(300, 700);
    await item.click({ timeout: 5000 });
    await pause(400, 900);
  }
  const d = skillsDiff(await chips(), target);
  if (d.remove.length || d.add.length) return { error: `навыки встали не так: лишние ${d.remove.join(', ') || 'нет'}, не хватает ${d.add.join(', ') || 'нет'}` };
  return {};
}

// Один раздел: форма → заполнить → снимок → (живая) «Сохранить» и ответ hh.
// → { kind, hhId?, outcome: dry | saved | same | error, note, shot, stop? } — stop: дальше не идти (капча, выход)
async function writeOne(page, hash, c, live, net) {
  const res = { kind: c.kind, ...(c.hhId && { hhId: c.hhId }), outcome: 'error', note: '', shot: '' };
  const open = await openForm(page, cvFormUrl(c.kind, hash, c.hhId));
  if (open.error) return { ...res, note: open.error, stop: true };
  const fill = c.kind === 'skills' ? await fillSkills(page, c.skills) : await fillFields(page, c);
  if (fill.error) return { ...res, note: fill.error, shot: await shot(`cv-${c.kind}-fail`).catch(() => '') };
  if (fill.same) return { ...res, outcome: 'same', note: 'на hh уже так' };
  res.shot = await shot(`cv-${c.kind}${live ? '' : '-dry'}`, SHOTS, { fullPage: true }).catch(() => '');
  if (!live) return { ...res, outcome: 'dry' };
  const action = c.kind === 'place' ? 'profile' : 'resume';
  // Порванный «шум» формы (автосохранение при загрузке) — не ответ на наше сохранение: старые события — прочь
  while (net.take(action));
  guardAllow(action);
  try {
    await pause(800, 1800);
    await page.locator(c.kind === 'place' ? SEL.cvPlaceSave : SEL.cvSave).first().click({ timeout: 8000 });
    const ev = await net.wait(action, 20000);
    if (!ev) return { ...res, note: 'hh не отправил форму (ошибка в поле?)', shot: await shot(`cv-${c.kind}-nosave`).catch(() => '') };
    const r = writeResult(action, ev.status, ev.body);
    return { ...res, outcome: r.ok ? 'saved' : 'error', note: r.note };
  } finally {
    guardReset();
  }
}

// → { ok: true, live, results, after } — after: резюме hh после живой записи (сверка) или null
export async function writeResume({ hash, changes, dry }) {
  const live = !dry && config.resumeLive;
  const page = await ensure();
  setGuard(true);
  guardReset();
  // «Уйти со страницы без сохранения?» (сухой прогон) — да
  const onDialog = (d) => d.accept().catch(() => {});
  page.on('dialog', onDialog);
  const net = watchActions(page.context(), { bodyMs: 3000 });
  const results = [];
  try {
    for (const c of changes) {
      const r = await writeOne(page, hash, c, live, net);
      results.push(r);
      log('resume.write', { kind: r.kind, hhId: r.hhId, outcome: r.outcome, live, note: r.note || undefined });
      if (r.outcome === 'error' || r.stop) break;
      await pause(1500, 3500);
    }
    // Сухой прогон — уйти с формы без сохранения; живая запись — прочитать резюме заново и сверить
    if (!live || !results.some((r) => r.outcome === 'saved')) {
      await page.goto(resumeUrl(hash), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      return { ok: true, live, results, after: null };
    }
  } finally {
    net.stop();
    guardReset();
    page.off('dialog', onDialog);
  }
  await pause(2000, 4000);
  const read = await readResume({ hash });
  return { ok: true, live, results, after: read.ok ? read.resume : null };
}
