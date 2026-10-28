// Общие действия со страницей для сценариев: проверка капчи, «чтение как человек», снимок видимых data-qa,
// прогноз отклика по данным, которые интерфейс hh запрашивает сам.
import { CHAT_FRAME, SEL } from '../hh/selectors.mjs';
import { popupPrediction } from '../hh/state.mjs';
import { pause, rand, sleep } from '../util.mjs';

// Видно ли (Playwright: ненулевой размер и не visibility:hidden — свёрнутое max-height:0 предупреждение не видно)
export const visible = (locator) => locator.first().isVisible().catch(() => false);
// Дождаться видимости ≤ ms
export const visibleWithin = (locator, ms) =>
  locator
    .first()
    .waitFor({ state: 'visible', timeout: ms })
    .then(
      () => true,
      () => false,
    );

// Показано по-настоящему, с высотой: hh держит предупреждения окна отклика в разметке свёрнутыми (max-height: 0,
// запись 10.10.2026 — «поменяйте видимость резюме» есть и в окне, где отклик прошёл)
// boundingBox ждёт появления элемента до таймаута контекста (20 с) — сначала count, он не ждёт (симуляция 11.10.2026)
export async function shownTall(locator, min = 8) {
  if (!(await locator.count().catch(() => 0))) return false;
  const box = await locator.first().boundingBox({ timeout: 1000 }).catch(() => null);
  return Boolean(box && box.width > 0 && box.height >= min);
}

export async function captchaShown(page) {
  if (/\/account\/captcha/.test(page.url())) return true;
  return visible(page.locator(SEL.captcha));
}

// Какая капча: smart — «Я не робот» (SmartCaptcha, решает человек в окне робота), captcha — картинка с текстом
// (фото в Telegram, ответ текстом → POST /captcha), null — капчи нет
export async function captchaKind(page) {
  if (await visible(page.locator(SEL.smartCaptcha))) return 'smart';
  if (/\/account\/captcha/.test(page.url())) return 'captcha';
  if (await visible(page.locator(`${SEL.captchaForm}, ${SEL.captchaInput}`))) return 'captcha';
  return null;
}

// Текст страницы (до 200 тыс. знаков) — для текстов-маркеров hh после клика
export const bodyText = (page) =>
  page
    .evaluate(() => (document.body?.innerText ?? '').slice(0, 200000).replace(/[\u00a0\u202f]/g, ' '))
    .catch(() => '');

// Закрыть открытые окна hh (Escape, потом крестик окна отклика)
export async function closeDialogs(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await pause(300, 600);
  const close = page.locator(SEL.modalClose).first();
  if (await visible(close)) await close.click({ timeout: 3000 }).catch(() => {});
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

// Поля форм страницы (разведка резюме): что можно править и с какими пределами — без значений, только их длина
export function formFields(frame) {
  return frame.evaluate(() =>
    [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')].slice(0, 300).map((e) => ({
      tag: e.tagName.toLowerCase(),
      type: e.getAttribute('type') ?? '',
      name: e.getAttribute('name') ?? '',
      dataQa: e.getAttribute('data-qa') ?? e.closest('[data-qa]')?.getAttribute('data-qa') ?? '',
      maxLength: typeof e.maxLength === 'number' && e.maxLength > 0 ? e.maxLength : null,
      length: String(e.value ?? e.innerText ?? '').length,
      visible: e.getClientRects().length > 0,
    })),
  );
}

// Кадр чата отклика: iframe виджета чатов на странице или отдельная вкладка (ждём ≤ ms)
export async function chatFrame(page, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const frame = page
      .context()
      .pages()
      .flatMap((p) => p.frames())
      .find((f) => CHAT_FRAME.test(f.url()));
    if (frame) return frame;
    await sleep(300);
  }
  return null;
}

// Область ввода чата (разведка 6.3a): поля, кнопки и предупреждения кадра — есть ли поле, активно ли, что hh пишет
// вместо него. Без текстов сообщений: у кнопок и предупреждений — подпись до 200 знаков
export function chatInputArea(frame) {
  return frame.evaluate(() => {
    const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const pick = (e) => ({
      tag: e.tagName.toLowerCase(),
      dataQa: e.getAttribute('data-qa') ?? e.closest('[data-qa]')?.getAttribute('data-qa') ?? '',
      visible: shown(e),
      disabled: e.disabled === true || e.getAttribute('aria-disabled') === 'true',
      readOnly: e.readOnly === true,
      editable: e.isContentEditable === true,
      placeholder: e.getAttribute('placeholder') ?? '',
      label: (e.getAttribute('aria-label') ?? e.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 200),
    });
    const all = (sel) => [...document.querySelectorAll(sel)];
    return {
      inputs: all('textarea, input[type="text"], [contenteditable="true"], [data-qa*="input"]').slice(0, 20).map(pick),
      buttons: all('button, [role="button"]').filter(shown).slice(0, 40).map(pick),
      warnings: all('[data-qa*="warning"], [data-qa*="disabled"], [data-qa*="notice"], [data-qa*="banner"], [role="alert"]')
        .filter(shown)
        .slice(0, 20)
        .map(pick),
    };
  });
}

// Ссылки страницы из живой разметки (часть страниц hh дорисовывает скрипт) — как атрибуты href="…" для разбора
export const pageHrefs = (frame) =>
  frame
    .evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))
    .then((list) => list.map((h) => `href="${h}"`).join('\n'))
    .catch(() => '');

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
