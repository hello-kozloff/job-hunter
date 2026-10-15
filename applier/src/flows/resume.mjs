// Чтение резюме hh (часть D, S2; docs/recommendations.md → «Разделы резюме»): «Мои резюме» → страница резюме → поля из
// InitialState (applicantResume). Без кликов, только GET: строгий предохранитель рвёт любой не-GET к hh (как разведка
// резюме, E0). Прочитанное резюме целиком — бэкап в /data/resume (30 дней): до первой записи на hh (E2/E3) есть что
// вернуть.
import { join } from 'node:path';
import { config } from '../config.mjs';
import { ensure, setGuard, shot, strictGuard } from '../browser.mjs';
import { log } from '../log.mjs';
import { store } from '../store.mjs';
import { RESUMES_URL, parseResume, pickResume, resumeList, resumeUrl } from '../hh/resume.mjs';
import { initialState, isCaptchaPage, isLoginUrl, redactState } from '../hh/state.mjs';
import { pause, prune, stamp, writeJsonAtomic } from '../util.mjs';
import { captchaShown } from './dom.mjs';

export const RESUME_DIR = join(config.dataDir, 'resume');

// Страница hh → { state } или { error: captcha | login | layout }. Капча — блок, как у отклика: дальше решает человек
async function openState(page, url) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const html = (await res?.text().catch(() => '')) ?? '';
  if (isCaptchaPage(page.url(), html) || (await captchaShown(page))) {
    store.block('captcha', { shot: await shot('captcha-resume') });
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
