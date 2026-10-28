// Поддельный hh для симуляции живого отклика (sim/live.mjs): страница вакансии, окно отклика, отклик в один клик,
// «Приложить письмо», чат отклика — с теми же data-qa и ответами, что в записи 10.10.2026
// (fixtures/applier/record-20261010-181350, docs/stages/stage-6.md → «Запись»). Поведение — из сценария.
// Напоминание (6.3, sim/remind.mjs): сценарий с remind — вакансия, на которую уже откликнулись (топик отклика, «Чат»
// сразу), чат с полем сообщения, chat_data и отправкой chatik/api/send, как в записи 28.10.2026 (record-20261028-112135).
import { guardBlocks } from '../src/browser.mjs';

const encode = (o) => JSON.stringify(o).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&#34;');

// Запросы сценария, кроме GET: { path, blocked, letter, text, resume }
export const posts = [];
// Каким резюме откликнулись: id вакансии → id резюме
const usedBy = new Map();
let current = null;
export const useScenario = (sc) => {
  current = sc;
  posts.length = 0;
};

// Резюме человека на hh (запись 16.10.2026): по умолчанию одно. Сценарий: resumes [{ id, hash, title, access, used }],
// defaultHash — выбрано в окне при открытии (lastResponseResumeHash)
const ONE = [{ id: '1', hash: 'h1', title: 'Frontend-разработчик (React, Next.js, TypeScript)', access: 'clients' }];
const resumesOf = (sc) => sc.resumes ?? ONE;
const defaultOf = (sc) => sc.defaultHash ?? resumesOf(sc)[0].hash;

// Топик отклика для напоминания: { lastState, viewed, ageDays, chatId, inbox, declined } → как в InitialState hh
const remindTopic = (id, t) => ({
  id: 5000 + Number(String(id).slice(-3)),
  vacancyId: Number(id),
  chatId: Number(t.chatId),
  lastState: t.lastState ?? 'RESPONSE',
  viewedByOpponent: Boolean(t.viewed),
  declinedByApplicant: Boolean(t.declined),
  hasNewMessages: false,
  conversationMessagesCount: 1,
  inboxAvailabilityState: t.inbox ?? 'AVAILABLE',
  responseReminderState: { allowed: !t.viewed },
  creationTime: new Date(Date.now() - (t.ageDays ?? 5) * 86400000).toISOString(),
});

function vacancyState(id) {
  const resumes = resumesOf(current);
  const used = (r) => Boolean(r.used) || Boolean(usedBy.get(String(id))?.has(r.id));
  const remind = current.remind;
  return {
    userType: remind?.loggedOut ? 'anonymous' : 'applicant',
    vacancyView: {
      vacancyFull: {
        vacancy: {
          vacancyId: Number(id),
          name: 'Frontend-разработчик (симуляция)',
          company: { visibleName: 'Sim' },
          status: { archived: Boolean(remind?.archived) },
          ...(remind && { chatWritePossibility: remind.chatWrite ?? 'ENABLED_AFTER_INVITATION' }),
        },
      },
    },
    ...(remind?.topic && { vacancyChatInfo: { [id]: { data: { chatId: Number(remind.topic.chatId) } } } }),
    applicantVacancyResponseStatuses: {
      [id]: {
        ...(remind && { alreadyApplied: Boolean(remind.topic), negotiations: { topicList: remind.topic ? [remindTopic(id, remind.topic)] : [] } }),
        usedResumeIds: resumes.filter(used).map((r) => r.id),
        unusedResumeIds: resumes.filter((r) => !used(r)).map((r) => r.id),
        resumes: Object.fromEntries(
          resumes.map((r) => [
            r.id,
            { _attributes: { id: r.id, hash: r.hash }, title: [{ string: r.title }], accessType: [{ string: r.access ?? 'clients' }] },
          ]),
        ),
        test: { hasTests: Boolean(current.hasTests) },
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
    visibility: sc.visibility ?? '',
    captchaInModal: sc.captchaInModal ?? false,
    resumes: resumesOf(sc),
    defaultHash: defaultOf(sc),
    // Окно выбора резюме: ok | missing (в списке нет второго резюме) | broken (клик по опции ничего не выбирает) | none (ячейка не кнопка)
    chooser: sc.chooser ?? 'ok',
    // Письмо необязательное (19.10.2026): поле свёрнуто под «Добавить сопроводительное» в подвале окна
    letterButton: Boolean(sc.letterButton),
    // После отклика «Приложить» и «Чат» закрыты прозрачным слоем: клик Playwright зависает (19.10.2026 так на hh)
    attachStuck: Boolean(sc.attachStuck),
    errorText: sc.errorText ?? 'Произошла ошибка, попробуйте ещё раз',
    // Чат, который откроет «Чат»: у отклика из сценария напоминания — его чат (или чужой — frameChatId)
    chatId: String(sc.remind?.frameChatId ?? sc.remind?.topic?.chatId ?? '555'),
  };
  const chatButton = sc.remind?.topic && !sc.remind.noChatButton ? '<a data-qa="vacancy-response-link-view-topic" href="#">Чат</a>' : '';
  const captcha = sc.remind?.captcha ? '<form action="/account/captcha"><input name="captchaText"></form>' : '';
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
${captcha}
<div id="out">${chatButton}</div>
<script>
const SIM = ${JSON.stringify(sim)};
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const out = document.getElementById('out');
const closeDialogs = () => document.querySelectorAll('[role=dialog], [role=alertdialog]').forEach((d) => d.remove());
// «Аналитика» страницы: не-GET к /shards/applicant/ — предохранитель обязан порвать и при живом отклике
fetch('/shards/applicant/sim_stats', { method: 'POST', body: 'x' }).catch(() => {});

let selected = SIM.defaultHash;
async function respond(letter) {
  const fd = new FormData();
  fd.append('vacancy_id', String(SIM.id));
  fd.append('resume_hash', selected);
  if (letter !== null) fd.append('letter', letter);
  const r = await fetch('/applicant/vacancy_response/popup', { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
function success(quick) {
  out.append(el('<div data-qa="vacancy-response-success-standard-notification">Резюме доставлено. Вы откликнулись</div>'));
  if (quick) out.append(el('<a data-qa="responded-success-attach-cover-letter" href="#">Приложить сопроводительное письмо</a>'));
  out.append(el('<a data-qa="vacancy-response-link-view-topic" href="#">Чат</a>'));
  if (SIM.attachStuck) document.body.append(el('<div data-sim="overlay" style="position:fixed;inset:0;z-index:100"></div>'));
}
const LETTER_INPUT = '<textarea data-qa="vacancy-response-popup-form-letter-input">Старое письмо из прошлого отклика</textarea>';
function showModal() {
  document.body.append(el(\`<div role="dialog">
    <div data-qa="modal-header">Отклик на вакансию</div>
    <\${SIM.chooser === 'none' ? 'div' : 'div role="button" tabindex="0"'} data-sim="resume-cell"><div data-qa="resume-title">\${SIM.resumes.find((r) => r.hash === selected).title}</div></div>
    <div data-qa="hidden-resume-warning" class="collapsed">Чтобы откликнуться на эту вакансию, поменяйте видимость резюме</div>
    <div id="letter">\${SIM.letterButton ? '' : LETTER_INPUT}</div>
    <div id="captcha"></div>
    <div id="err"></div>
    <button data-qa="response-popup-close">×</button>
    \${SIM.letterButton ? '<button type="button" data-qa="add-cover-letter">Добавить сопроводительное</button>' : ''}
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
// Окно выбора резюме: ячейка (role=button) открывает список опций magritte-select-option-<хеш>
function openList() {
  document.querySelectorAll('[data-qa="drop-base"]').forEach((d) => d.remove());
  const options = SIM.resumes.filter((r) => SIM.chooser !== 'missing' || r.hash === SIM.defaultHash);
  document.body.append(el(\`<div role="dialog" data-qa="drop-base"><div role="listbox" data-qa="magritte-select-option-list">\${options
    .map((r) => \`<label role="option" data-qa="magritte-select-option-\${r.hash}" aria-selected="\${r.hash === selected}"><div data-qa="resume-title">\${r.title}</div></label>\`)
    .join('')}</div></div>\`));
}
document.addEventListener('click', async (e) => {
  const cell = e.target.closest('[role=button][data-sim="resume-cell"]');
  if (cell) return openList();
  const option = e.target.closest('[role=option]');
  if (option) {
    if (SIM.chooser !== 'broken') {
      selected = option.getAttribute('data-qa').replace('magritte-select-option-', '');
      document.querySelector('[data-sim="resume-cell"] [data-qa="resume-title"]').textContent = SIM.resumes.find((r) => r.hash === selected).title;
    }
    return document.querySelectorAll('[data-qa="drop-base"]').forEach((d) => d.remove());
  }
  const qa = e.target.closest('[data-qa]')?.getAttribute('data-qa');
  if (!qa) return;
  e.preventDefault();
  if (qa === 'vacancy-response-link-top') {
    if (SIM.click === 'nothing') return;
    if (SIM.click === 'external') return window.open('https://employer.example.com/apply', '_blank');
    await fetch('/applicant/vacancy_response/popup?vacancyId=' + SIM.id);
    if (SIM.visibility) {
      // Та же кнопка «Разрешить и продолжить» без текста про страну — её робот жать не должен
      return document.body.append(el(\`<div role="dialog">
        <div>Чтобы откликнуться на вакансию, разрешите работодателям из \${SIM.visibility} видеть ваш профиль и предлагать вакансии</div>
        <button>Отменить</button><button data-qa="sim-allow">Разрешить и продолжить</button></div>\`));
    }
    if (SIM.relocation) {
      return document.body.append(el(\`<div role="alertdialog">
        <div data-qa="relocation-warning-title">Вы откликаетесь на вакансию в другой стране</div>
        <button data-qa="relocation-warning-abort">Отмена</button>
        <button data-qa="relocation-warning-confirm">Все равно откликнуться</button></div>\`));
    }
    return proceed();
  }
  if (qa === 'relocation-warning-confirm' || qa === 'sim-allow') { closeDialogs(); return proceed(); }
  if (qa === 'response-popup-close') return closeDialogs();
  if (qa === 'add-cover-letter') {
    document.getElementById('letter').innerHTML = LETTER_INPUT;
    return e.target.closest('[data-qa]').remove();
  }
  if (qa === 'vacancy-response-submit-popup') {
    const letter = document.querySelector('[role=dialog] [data-qa="vacancy-response-popup-form-letter-input"]')?.value ?? null;
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
    out.append(el('<iframe src="https://chatik.hh.ru/chat/' + SIM.chatId + '?without_list=1" width="420" height="520"></iframe>'));
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

// Чат отклика для напоминания (запись 28.10.2026): сообщения из chat_data, поле text-input в chatik-message-input,
// «Отправить» после набора (и Enter), «печатает…» — participant_action, отправка — chatik/api/send. Писать нельзя —
// вместо поля предупреждение hh. optimistic — пузырь появляется сразу (ответ hh может и не прийти)
const remindChatPage = (sc, chatId) => {
  const c = sc.remind.chat ?? {};
  const sim = { chatId, write: c.write !== false, warning: c.warning ?? 'Работодатель отключил переписку по данной вакансии', optimistic: Boolean(c.optimistic), sendError: c.sendError ?? '' };
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body>
<div data-qa="chatik-header-vacancy-link-text">Frontend-разработчик (симуляция)</div>
<div id="list"></div><div id="err"></div><div id="box"></div>
<script>
const SIM = ${JSON.stringify(sim)};
const list = document.getElementById('list');
const bubble = (id, text) => '<div data-qa="chatik-chat-message-' + id + '"><div data-qa="chatik-chat-message-bubble chatik-chat-message-' + id + '-text"></div></div>';
const add = (id, text) => { list.insertAdjacentHTML('beforeend', bubble(id)); list.lastElementChild.firstElementChild.textContent = text; };
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
post('/chatik/api/notify_chat_opened', { chatId: Number(SIM.chatId) }).catch(() => {});
fetch('/chatik/api/chat_data?chatId=' + SIM.chatId + '&do_not_track_session_events=true')
  .then((r) => r.json())
  .then((d) => (d.chat?.messages?.items ?? []).forEach((m) => add(m.id, m.text)))
  .catch(() => {});
const box = document.getElementById('box');
if (!SIM.write) {
  box.innerHTML = '<div data-qa="chatik-warning"></div>';
  box.firstElementChild.textContent = SIM.warning;
} else {
  box.innerHTML = '<div data-qa="chatik-message-input"><textarea data-qa="text-input" placeholder="Message"></textarea></div>';
  const input = box.querySelector('textarea');
  let typing = false;
  input.addEventListener('input', () => {
    if (!typing) { typing = true; post('/chatik/api/participant_action', { chatId: Number(SIM.chatId), actionType: 'TYPING' }).catch(() => {}); }
    if (!document.querySelector('[data-qa="chatik-do-send-message"]')) box.insertAdjacentHTML('beforeend', '<button data-qa="chatik-do-send-message">Отправить</button>');
  });
  const send = async () => {
    const text = input.value;
    if (!text) return;
    if (SIM.optimistic) add('tmp', text);
    const r = await post('/chatik/api/send?hhtmSourceLabel=chat&hhtmSource=chat', { chatId: Number(SIM.chatId), idempotencyKey: 'sim-' + Date.now(), text }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok && body.id) { input.value = ''; if (!SIM.optimistic) add(body.id, text); }
    else if (SIM.sendError) document.getElementById('err').textContent = SIM.sendError;
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-qa="chatik-do-send-message"]')) send(); });
}
</script></body></html>`;
};

// chat_data чата отклика: сообщение отклика (с workflowTransition) и сообщения сценария; можно ли писать
function remindChatData(sc, chatId) {
  const c = sc.remind.chat ?? {};
  const closed = c.write === false;
  const items = [
    { id: 1, participantId: 'me', text: 'Сопроводительное письмо отклика', type: 'SIMPLE', workflowTransition: { applicantState: 'RESPONSE' }, participantDisplay: { isBot: false } },
    ...(c.messages ?? []).map((m, i) => ({ id: 10 + i, participantId: m.mine ? 'me' : 'hr', text: m.text, type: 'SIMPLE', participantDisplay: { isBot: Boolean(m.bot) } })),
  ];
  return {
    chat: {
      id: Number(chatId),
      type: 'NEGOTIATION',
      currentParticipantId: 'me',
      writePossibility: { name: closed ? 'DISABLED_FOR_APPLICANT_BY_VACANCY_SETTINGS' : 'ENABLED_FOR_ALL', writeDisabledReasons: closed ? ['DISABLED_BY_EMPLOYER'] : [] },
      messages: { items, hasMore: false },
    },
    chatStates: { writeMessageState: { allowed: !closed, reasons: closed ? ['DISABLED_BY_EMPLOYER'] : [] }, responseReminderState: { allowed: true } },
  };
}

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
    posts.push({ path: url.pathname, blocked: false, letter: field(post, 'letter'), text: text ?? null, resume: field(post, 'resume_hash') });
  }
  const id = url.pathname.match(/^\/vacancy\/(\d+)/)?.[1] ?? url.searchParams.get('vacancyId');
  if (host === 'chatik.hh.ru') {
    const chatId = url.pathname.match(/^\/chat\/(\d+)/)?.[1];
    if (chatId) {
      const body = sc.remind ? remindChatPage(sc, chatId) : chatPage(sc.chatAction ?? 'Добавить сопроводительное');
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    }
    if (sc.remind && url.pathname === '/chatik/api/chat_data') {
      if (sc.remind.chat?.data === false) return json(route, 500, { error: 'sim' });
      return json(route, 200, remindChatData(sc, url.searchParams.get('chatId')));
    }
    if (sc.remind && url.pathname === '/chatik/api/send') {
      const sent = JSON.parse(post || '{}');
      const message = { id: 16033098677, chatId: sent.chatId, text: sent.text, type: 'SIMPLE', participantId: 'me', creationTime: new Date().toISOString() };
      // Ответ hh потерялся: сообщение ушло, а ответа робот не дождётся
      if (sc.remind.send === 'lost') return new Promise((resolve) => setTimeout(() => resolve(json(route, 200, message).catch(() => {})), 20000));
      if (Array.isArray(sc.remind.send)) return json(route, ...sc.remind.send);
      return json(route, 200, message);
    }
    return json(route, 200, { enable_dark_theme: false, enable_zp_theme: false });
  }
  if (url.pathname.startsWith('/vacancy/')) {
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: vacancyPage(id, sc) });
  }
  if (url.pathname === '/applicant/vacancy_response/popup' && post === null) {
    const status = { by_country_applicant_visibility: { responseAllowed: true }, test: { hasTests: false } };
    if (sc.type === 'quickResponse') {
      return json(route, 200, { type: 'quickResponse', body: { resume_hash: defaultOf(sc), letterRequired: false, responseStatus: status } });
    }
    return json(route, 200, {
      type: sc.type,
      relocationWarning: { show: Boolean(sc.relocation) },
      lastResponseResumeHash: defaultOf(sc),
      responseStatus: status,
    });
  }
  if (url.pathname === '/applicant/vacancy_response/popup') {
    if (Array.isArray(sc.respond)) return json(route, sc.respond[0], sc.respond[1]);
    const withLetter = Boolean(field(post, 'letter'));
    // Откликнулись тем резюме, хеш которого в форме (в одиночных сценариях — единственным)
    const used = resumesOf(sc).find((r) => r.hash === field(post, 'resume_hash')) ?? resumesOf(sc)[0];
    usedBy.set(String(sc.id), new Set([...(usedBy.get(String(sc.id)) ?? []), used.id]));
    return json(route, 200, {
      success: 'true',
      topic_id: '1',
      chat_id: '555',
      response_label: `nonreq-letter-no-test-${withLetter ? 'with' : 'without'}-letter`,
      vacancy_id: String(sc.id),
      responseStatus: { alreadyApplied: true, usedResumeIds: [used.id] },
    });
  }
  if (url.pathname === '/applicant/vacancy_response/edit_ajax') return json(route, ...(sc.edit ?? [403, { error: 'notEditable' }]));
  return route.fulfill({ status: 404, body: '' });
}
