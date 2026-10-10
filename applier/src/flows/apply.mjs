// Сценарий отклика на одну вакансию → исход и его группа для n8n (src/hh/state.mjs → GROUP).
// Этап 6.0: всё до «точки сухого прогона» — открыть вакансию вошедшим, проверить факты, найти «Откликнуться» и
// не нажимать. Ветки после клика (окно с письмом, один клик, «другая страна», чат) — этап 6.1b.
import { config } from '../config.mjs';
import { ensure, setGuard, shot } from '../browser.mjs';
import { log } from '../log.mjs';
import { store } from '../store.mjs';
import { SEL, TEXT, vacancyUrl } from '../hh/selectors.mjs';
import { GROUP, initialState, isCaptchaPage, isLoginUrl, vacancyFacts } from '../hh/state.mjs';
import { captchaShown, humanRead, predictResponse, predictionText } from './dom.mjs';

// Что из фактов вакансии уходит в ответ (без списков id резюме)
const brief = (f) => ({
  title: f.title,
  company: f.company,
  country: f.country,
  letterRequired: f.letterRequired,
  hasTests: f.hasTests,
  chatWrite: f.chatWrite,
  resumes: f.resumes.unused.length + f.resumes.used.length,
});

export async function applyFlow({ vacancyId, letter = '' }) {
  const id = String(vacancyId).replace(/\D/g, '');
  const t0 = Date.now();
  const trace = [];
  const step = (s, extra = {}) => trace.push({ s, ms: Date.now() - t0, ...extra });
  const done = (outcome, fields = {}) => {
    const result = { outcome, group: GROUP[outcome], ms: Date.now() - t0, trace, ...fields };
    log('apply', { vacancyId: id, outcome, note: fields.note, shot: fields.shot, ms: result.ms });
    return result;
  };
  if (!id) return done('error', { note: 'нет id вакансии' });

  const page = await ensure();
  // В 6.0 живого сценария нет: предохранитель включён всегда
  setGuard(true);

  let res;
  try {
    res = await page.goto(vacancyUrl(id), { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    return done('error', { note: `hh не открылся: ${e.message.split('\n')[0]}` });
  }
  const status = res?.status() ?? 0;
  const html = (await res?.text().catch(() => '')) ?? '';
  step('open', { status });

  if (isCaptchaPage(page.url(), html) || (await captchaShown(page))) {
    const name = await shot(`captcha-${id}`);
    store.block('captcha', { shot: name });
    return done('captcha', { shot: name });
  }
  if (isLoginUrl(page.url())) {
    store.block('login');
    return done('login', { shot: await shot(`login-${id}`) });
  }

  const state = initialState(html);
  if (!state) return done('error', { note: `нет данных страницы (HTTP ${status})`, shot: await shot(`no-state-${id}`) });
  const facts = vacancyFacts(state, id);
  step('facts', { loggedIn: facts.loggedIn, applied: facts.applied, tests: facts.hasTests, archived: facts.archived });

  if (!facts.found) return done(status === 404 ? 'archived' : 'error', { note: `вакансии нет на hh (HTTP ${status})` });
  if (!facts.loggedIn) {
    store.block('login');
    return done('login', { note: 'робот не вошёл в hh', shot: await shot(`login-${id}`) });
  }
  if (facts.archived || facts.closed) return done('archived', { facts: brief(facts) });
  // hh — истина: отклик уже есть (вручную, через бота или повтор после обрыва связи)
  if (facts.applied) return done('already', { confirmed: true, facts: brief(facts) });
  if (facts.hasTests) return done('test', { note: 'у вакансии вопросы работодателя', facts: brief(facts) });
  if (letter.length > facts.letterMax) {
    return done('error', { note: `письмо длиннее ${facts.letterMax} знаков`, facts: brief(facts) });
  }

  const button = page.locator(SEL.applyButton).first();
  const visible = await button.waitFor({ state: 'visible', timeout: 15000 }).then(
    () => true,
    () => false,
  );
  if (!visible) {
    const body = await page.locator('body').innerText().catch(() => '');
    if (TEXT.responded.test(body)) return done('already', { facts: brief(facts) });
    return done('error', { note: 'на странице нет кнопки «Откликнуться»', shot: await shot(`no-button-${id}`) });
  }

  await humanRead(page);
  step('ready');

  // Точка сухого прогона: дальше — необратимый клик. В 6.0 робот всегда останавливается здесь
  const predicted = await predictResponse(page, id);
  step('predict', { status: predicted.status });
  await button.evaluate((el) => {
    el.style.outline = '4px solid #e53935';
    el.style.outlineOffset = '2px';
  });
  const name = await shot(`dry-${id}`);
  const note = config.live
    ? `живой сценарий появится в 6.1b — сейчас только сухой прогон; ${predictionText(predicted.prediction, facts)}`
    : predictionText(predicted.prediction, facts);
  return done('dry_run', { prediction: predicted.prediction, facts: brief(facts), shot: name, note });
}
