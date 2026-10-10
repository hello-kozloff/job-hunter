// Общие действия со страницей для сценариев: проверка капчи, «чтение как человек», снимок видимых data-qa,
// прогноз отклика по данным, которые интерфейс hh запрашивает сам.
import { SEL } from '../hh/selectors.mjs';
import { popupPrediction } from '../hh/state.mjs';
import { pause, rand } from '../util.mjs';

export async function captchaShown(page) {
  if (/\/account\/captcha/.test(page.url())) return true;
  return page
    .locator(SEL.captcha)
    .first()
    .isVisible()
    .catch(() => false);
}

// Пауза «чтения» 3–8 с с прокруткой — как человек, открывший вакансию по ссылке из Telegram
export async function humanRead(page) {
  await pause(1500, 3000);
  await page.mouse.wheel(0, rand(300, 900)).catch(() => {});
  await pause(1500, 4000);
  await page.mouse.wheel(0, -rand(200, 600)).catch(() => {});
  await pause(500, 1200);
}

// Есть ли, видно ли и первые слова — по списку селекторов (разведка, запись, отчёт о сбое)
export function watchSelectors(frame, watch) {
  return frame.evaluate((watch) => {
    const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const out = {};
    for (const [name, selector] of Object.entries(watch)) {
      const all = [...document.querySelectorAll(selector)];
      const vis = all.filter(shown);
      if (!all.length) continue;
      out[name] = {
        count: all.length,
        visible: vis.length,
        text: (vis[0]?.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
      };
    }
    return out;
  }, watch);
}

// Все видимые data-qa кадра — «подпись» экрана для записи: сменилась — что-то произошло
export function visibleDataQa(frame) {
  return frame.evaluate(() => {
    const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    return [...new Set([...document.querySelectorAll('[data-qa]')].filter(shown).map((e) => e.getAttribute('data-qa')))]
      .sort();
  });
}

// Прогноз исхода без клика: GET /applicant/vacancy_response/popup — тот же запрос, что интерфейс hh делает при
// нажатии «Откликнуться». Только в сухом прогоне и разведке; формат уточняет разведка (popupPrediction терпимый)
export async function predictResponse(page, vacancyId) {
  try {
    const r = await page.evaluate(async (id) => {
      const res = await fetch(`/applicant/vacancy_response/popup?vacancyId=${id}`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      return { status: res.status, text: await res.text() };
    }, String(vacancyId));
    let body = null;
    try {
      body = JSON.parse(r.text);
    } catch {
      // не JSON — прогноза нет, ответ сохраняет разведка
    }
    return { status: r.status, prediction: popupPrediction(body), body };
  } catch (e) {
    return { status: 0, prediction: null, error: e.message.split('\n')[0] };
  }
}

// Короткая подпись прогноза для Telegram — что hh покажет по «Откликнуться» (типы — src/hh/state.mjs popupPrediction)
const TYPE_TEXT = {
  modal: 'окно с письмом до отправки',
  quickResponse: 'отклик в один клик, письмо — сразу после',
  'test-required': 'вопросы работодателя',
  alreadyApplied: 'отклик уже есть',
  'need-login': 'робот не вошёл в hh',
};
export function predictionText(p, facts) {
  if (!p) return 'исход заранее неизвестен';
  const parts = [TYPE_TEXT[p.type] ?? `hh: ${p.type ?? 'тип не указан'}`];
  if (p.letterRequired || facts?.letterRequired) parts.push('письмо обязательно');
  if (p.relocation) parts.push('hh спросит «вакансия в другой стране»');
  if (p.inconsistencies) parts.push('hh предупредит «может получить отказ»');
  if (p.responseAllowed === false) parts.push('hh не даст откликнуться: видимость резюме');
  return parts.join(', ');
}
