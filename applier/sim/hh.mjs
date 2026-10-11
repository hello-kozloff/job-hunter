// Поддельный hh для симуляции живого отклика (sim/live.mjs): страница вакансии, окно отклика, отклик в один клик,
// «Приложить письмо», чат отклика — с теми же data-qa и ответами, что в записи 10.10.2026
// (fixtures/applier/record-20261010-181350, docs/stages/stage-6.md → «Запись»). Поведение — из сценария.
import { guardBlocks } from '../src/browser.mjs';

const encode = (o) => JSON.stringify(o).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&#34;');

// Запросы сценария, кроме GET: { path, blocked, letter, text }
export const posts = [];
const applied = new Set();
let current = null;
export const useScenario = (sc) => {
  current = sc;
  posts.length = 0;
};

function vacancyState(id) {
  return {
    userType: 'applicant',
    vacancyView: {
      vacancyFull: {
        vacancy: { vacancyId: Number(id), name: 'Frontend-разработчик (симуляция)', company: { visibleName: 'Sim' }, status: { archived: false } },
      },
    },
    applicantVacancyResponseStatuses: {
      [id]: {
        usedResumeIds: applied.has(String(id)) ? [1] : [],
        unusedResumeIds: applied.has(String(id)) ? [] : [1],
        test: { hasTests: false },
        letterMaxLength: 10000,
        shortVacancy: {},
      },
    },
  };
}

// Страница вакансии: кнопка «Откликнуться» и всё, что hh показывает после неё (скрипт по сценарию SIM)
function vacancyPage(id, sc) {
  const sim = {
    id,
    type: sc.type,
    click: sc.click ?? 'popup',
    relocation: Boolean(sc.relocation),
    captchaInModal: sc.captchaInModal ?? false,
    errorText: sc.errorText ?? 'Произошла ошибка, попробуйте ещё раз',
  };
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Sim ${id}</title>
<style>
  body { font-family: sans-serif; margin: 40px; }
  [role=dialog], [role=alertdialog] { position: fixed; top: 60px; left: 320px; width: 620px; background: #fff;
    border: 2px solid #333; padding: 20px; z-index: 10; }
  textarea { width: 100%; height: 140px; }
  .collapsed { max-height: 0; overflow: hidden; }
</style></head><body>
<template id="HH-Lux-InitialState">${encode(vacancyState(id))}</template>
<h1>Frontend-разработчик (симуляция)</h1>
<p>Описание: React, TypeScript. Удалённо.</p>
<a data-qa="vacancy-response-link-top" href="/applicant/vacancy_response?vacancyId=${id}">Откликнуться</a>
<div id="out"></div>
<script>
const SIM = ${JSON.stringify(sim)};
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const out = document.getElementById('out');
const closeDialogs = () => document.querySelectorAll('[role=dialog], [role=alertdialog]').forEach((d) => d.remove());
// «Аналитика» страницы: не-GET к /shards/applicant/ — предохранитель обязан порвать и при живом отклике
fetch('/shards/applicant/sim_stats', { method: 'POST', body: 'x' }).catch(() => {});

async function respond(letter) {
  const fd = new FormData();
  fd.append('vacancy_id', String(SIM.id));
  if (letter !== null) fd.append('letter', letter);
  const r = await fetch('/applicant/vacancy_response/popup', { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
function success(quick) {
  out.append(el('<div data-qa="vacancy-response-success-standard-notification">Резюме доставлено. Вы откликнулись</div>'));
  if (quick) out.append(el('<a data-qa="responded-success-attach-cover-letter" href="#">Приложить сопроводительное письмо</a>'));
  out.append(el('<a data-qa="vacancy-response-link-view-topic" href="#">Чат</a>'));
}
function showModal() {
  document.body.append(el(\`<div role="dialog">
    <div data-qa="modal-header">Отклик на вакансию</div>
    <div data-qa="resume-title">Frontend-разработчик (React, Next.js, TypeScript)</div>
    <div data-qa="hidden-resume-warning" class="collapsed">Чтобы откликнуться на эту вакансию, поменяйте видимость резюме</div>
    <textarea data-qa="vacancy-response-popup-form-letter-input">Старое письмо из прошлого отклика</textarea>
    <div id="captcha"></div>
    <div id="err"></div>
    <button data-qa="response-popup-close">×</button>
    <button data-qa="vacancy-response-submit-popup">Откликнуться</button>
  </div>\`));
  if (SIM.captchaInModal) {
    // Поле капчи — через DOM: в исходнике страницы не должно быть разметки капчи (робот проверяет и HTML).
    // late — через секунду: робот уже вставляет письмо (гонка «экран сменился до нажатия»)
    const add = () => {
      const input = document.createElement('input');
      input.name = 'captcha' + 'Text';
      document.getElementById('captcha')?.append(input);
    };
    if (SIM.captchaInModal === 'late') setTimeout(add, 1000);
    else add();
  }
}
async function proceed() {
  if (SIM.type === 'modal') return showModal();
  if (SIM.type === 'quickResponse') {
    const r = await respond(null);
    if (r.body.success === 'true') success(true);
    else out.append(el('<div>' + SIM.errorText + '</div>'));
  }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialogs(); });
document.addEventListener('click', async (e) => {
  const qa = e.target.closest('[data-qa]')?.getAttribute('data-qa');
  if (!qa) return;
  e.preventDefault();
  if (qa === 'vacancy-response-link-top') {
    if (SIM.click === 'nothing') return;
    if (SIM.click === 'external') return window.open('https://employer.example.com/apply', '_blank');
    await fetch('/applicant/vacancy_response/popup?vacancyId=' + SIM.id);
    if (SIM.relocation) {
      return document.body.append(el(\`<div role="alertdialog">
        <div data-qa="relocation-warning-title">Вы откликаетесь на вакансию в другой стране</div>
        <button data-qa="relocation-warning-abort">Отмена</button>
        <button data-qa="relocation-warning-confirm">Все равно откликнуться</button></div>\`));
    }
    return proceed();
  }
  if (qa === 'relocation-warning-confirm') { closeDialogs(); return proceed(); }
  if (qa === 'response-popup-close') return closeDialogs();
  if (qa === 'vacancy-response-submit-popup') {
    const letter = document.querySelector('[data-qa="vacancy-response-popup-form-letter-input"]').value;
    const r = await respond(letter);
    if (r.body.success === 'true') { closeDialogs(); return success(false); }
    document.getElementById('err').textContent = SIM.errorText;
    return;
  }
  if (qa === 'responded-success-attach-cover-letter') {
    return document.body.append(el(\`<div role="dialog"><div>Сопроводительное письмо</div>
      <textarea data-qa="vacancy-response-popup-form-letter-input"></textarea>
      <button data-qa="vacancy-response-letter-submit">Отправить</button></div>\`));
  }
  if (qa === 'vacancy-response-letter-submit') {
    const fd = new FormData();
    fd.append('text', document.querySelector('[role=dialog] textarea').value);
    const r = await fetch('/applicant/vacancy_response/edit_ajax', { method: 'POST', body: fd });
    if (r.ok) { closeDialogs(); out.append(el('<div>Письмо приложено</div>')); }
    return;
  }
  if (qa === 'vacancy-response-link-view-topic') {
    out.append(el('<iframe src="https://chatik.hh.ru/chat/555?without_list=1" width="420" height="520"></iframe>'));
  }
});
</script></body></html>`;
}

// Чат отклика (chatik.hh.ru/chat/<id>): «Добавить сопроводительное» → поле → «Отправить» → POST /chatik/api/save
const chatPage = (action) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body>
<div>Отклик на вакансию · Без сопроводительного письма</div>
<div data-qa="chatik-chat-message-applicant-action"><span data-qa="chatik-chat-message-applicant-action-text">⊕ ${action}</span></div>
<div id="box"></div>
<script>
fetch('/chatik/api/notify_chat_opened', { method: 'POST', body: '{"chatId":555}' });
document.addEventListener('click', async (e) => {
  const qa = e.target.closest('[data-qa]')?.getAttribute('data-qa') ?? '';
  if (qa.startsWith('chatik-chat-message-applicant-action')) {
    const box = document.getElementById('box');
    box.innerHTML = '<div data-qa="chat-input-preview">Сопроводительное письмо</div>'
      + '<div data-qa="chatik-message-input"><textarea data-qa="text-input"></textarea></div>';
    box.querySelector('textarea').addEventListener('input', () => {
      if (!document.querySelector('[data-qa="chatik-do-send-message"]')) {
        box.insertAdjacentHTML('beforeend', '<button data-qa="chatik-do-send-message">Отправить</button>');
      }
    });
  }
  if (qa === 'chatik-do-send-message') {
    const text = document.querySelector('textarea').value;
    await fetch('/chatik/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, messageId: 1 }) });
    document.getElementById('box').textContent = 'Отправлено';
  }
});
</script></body></html>`;

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const field = (post, name) => post.match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`))?.[1] ?? null;

// Обработчик всех запросов браузера: поддельный hh отвечает, остальное рвётся — к настоящему hh ни одного запроса
export async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const host = url.hostname;
  if (host === 'employer.example.com') return route.fulfill({ contentType: 'text/html', body: '<h1>Сайт работодателя</h1>' });
  if (!/(^|\.)hh\.ru$/.test(host)) return route.abort();
  const post = req.method() === 'GET' ? null : (req.postData() ?? '');
  // Предохранитель — та же функция, что в боевом браузере (его маршруты здесь не срабатывают: этот — первый)
  if (guardBlocks(req)) {
    if (post !== null) posts.push({ path: url.pathname, blocked: true });
    return route.abort('blockedbyclient');
  }
  const sc = current;
  if (post !== null) {
    let text = null;
    try {
      text = host === 'chatik.hh.ru' ? JSON.parse(post || '{}').text : field(post, 'text');
    } catch {
      // не JSON — текста нет
    }
    posts.push({ path: url.pathname, blocked: false, letter: field(post, 'letter'), text: text ?? null });
  }
  const id = url.pathname.match(/^\/vacancy\/(\d+)/)?.[1] ?? url.searchParams.get('vacancyId');
  if (host === 'chatik.hh.ru') {
    if (url.pathname.startsWith('/chat/')) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: chatPage(sc.chatAction ?? 'Добавить сопроводительное') });
    }
    return json(route, 200, { enable_dark_theme: false, enable_zp_theme: false });
  }
  if (url.pathname.startsWith('/vacancy/')) {
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: vacancyPage(id, sc) });
  }
  if (url.pathname === '/applicant/vacancy_response/popup' && post === null) {
    const status = { by_country_applicant_visibility: { responseAllowed: true }, test: { hasTests: false } };
    if (sc.type === 'quickResponse') {
      return json(route, 200, { type: 'quickResponse', body: { resume_hash: 'h', letterRequired: false, responseStatus: status } });
    }
    return json(route, 200, { type: sc.type, relocationWarning: { show: Boolean(sc.relocation) }, responseStatus: status });
  }
  if (url.pathname === '/applicant/vacancy_response/popup') {
    if (Array.isArray(sc.respond)) return json(route, sc.respond[0], sc.respond[1]);
    const withLetter = Boolean(field(post, 'letter'));
    applied.add(String(sc.id));
    return json(route, 200, {
      success: 'true',
      topic_id: '1',
      chat_id: '555',
      response_label: `nonreq-letter-no-test-${withLetter ? 'with' : 'without'}-letter`,
      vacancy_id: String(sc.id),
      responseStatus: { alreadyApplied: true, usedResumeIds: [1] },
    });
  }
  if (url.pathname === '/applicant/vacancy_response/edit_ajax') return json(route, ...(sc.edit ?? [403, { error: 'notEditable' }]));
  return route.fulfill({ status: 404, body: '' });
}
