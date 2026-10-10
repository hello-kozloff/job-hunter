// Всё, что робот знает о вёрстке hh, — в одном файле: сломалась вёрстка → правится только он.
// Только атрибуты data-qa (классы вида magritte-button___Pubhr_7-3-1 меняются с каждым релизом hh) и тексты-маркеры.
// Источники: открытые проекты BlazeStudio/HH-Auto-Response (10.10.2026) и fikstt2/hh-ai-agent, карта адресов
// Vlad9572324/hh.ru-clicker (03.10.2026), наши фикстуры. Разведка 6.0 подтверждает на живом входе
// (docs/stages/stage-6.md → «Разведка»).

export const HH = 'https://hh.ru';
export const vacancyUrl = (id) => `${HH}/vacancy/${id}`;
export const LOGIN_URL = `${HH}/account/login?backurl=%2Fapplicant%2Fresumes`;
export const NEGOTIATIONS_URL = `${HH}/applicant/negotiations`;
export const CHATIK = 'https://chatik.hh.ru';

export const SEL = {
  // Страница вакансии
  applyButton: '[data-qa="vacancy-response-link-top"]',
  description: '[data-qa="vacancy-description"]',
  // Окно отклика: письмо до отправки
  modalSubmit: '[data-qa="vacancy-response-submit-popup"]',
  letterInput: '[data-qa="vacancy-response-popup-form-letter-input"]',
  letterToggle: '[data-qa="vacancy-response-letter-toggle"]',
  resumeTitle: '[data-qa="resume-title"]',
  hiddenResume: '[data-qa="hidden-resume-warning"]',
  modalClose: '[data-qa="response-popup-close"]',
  // Отклик в один клик: уже ушёл, письмо прикладывается после
  attachLetter: '[data-qa="responded-success-attach-cover-letter"]',
  letterInformer: '[data-qa="vacancy-response-letter-informer"]',
  letterSubmit: '[data-qa="vacancy-response-letter-submit"]',
  success: '[data-qa="vacancy-response-success"]',
  viewTopic: '[data-qa="vacancy-response-link-view-topic"]',
  // «Вакансия в другой стране» (role=alertdialog)
  relocationTitle: '[data-qa="relocation-warning-title"]',
  relocationConfirm: '[data-qa="relocation-warning-confirm"]',
  relocationAbort: '[data-qa="relocation-warning-abort"]',
  // Вопросы и тест работодателя
  questions: '[data-qa="employer-asking-for-test"], [data-qa="task-question"], [data-qa="task-body"]',
  taskTextarea: 'textarea[name^="task_"]',
  // Чат отклика (iframe chatik.hh.ru)
  chatText: 'textarea[data-qa="text-input"]',
  chatSend: '[data-qa="chatik-do-send-message"]',
  // Вход и капча — только по структуре: слово «captcha» есть и на обычных страницах (CLAUDE.md §8.1)
  loginForm: '[data-qa="account-login-form"]',
  captcha: 'form[action*="/account/captcha"], input[name="captchaText"], iframe[src*="smartcaptcha"]',
  captchaImage: 'form[action*="/account/captcha"] img, img[src*="captcha"]',
  // Отклики
  negotiationsItem: '[data-qa="negotiations-item"]',
  dialog: '[role="dialog"], [role="alertdialog"]',
};

// Тексты-маркеры — дословно из переводов hh (InitialState → trl, fixtures/vacancy.html, 10.10.2026)
export const TEXT = {
  // negotiationsLimitExceeded: «В течение 24 часов можно совершить не более 200 откликов. Вы исчерпали лимит…»
  limit: /не более \d+ откликов|исчерпали лимит откликов/i,
  // alreadyResponded, alreadyApplied, responded.success.title
  responded: /Вы откликнулись|Вы уже откликались|Резюме доставлено|Вас пригласили/i,
  viewed: /Отклик уже просмотрен работодателем/i,
  test: /требуется ответить на вопросы теста/i,
  // hidden.resumes, changeResumeVisibilityDenied
  hidden: /поменяйте видимость резюме|с текущей видимостью резюме/i,
  // resourcePolicyViolation, spamDetected, inappropriateLanguage — дальше не отправляем, зовём человека
  stop: /нарушает правила сервиса|Недопустимое сообщение|уберите нецензурные слова/i,
  // unknown.error, testServiceDown, vacancyResponseAbort, tooLongLetter, letter.tooLong
  failed: /Произошла ошибка|сайт перегружен|Отклик не был доставлен|Превышен лимит символов|не может превышать \d+ символов/i,
  // vacancy.respond.popup.title + force («Все равно откликнуться»)
  relocation: /Вы откликаетесь на вакансию в другой стране/i,
  // vacancyResponse.rejectWarning.title, inconsistency.title
  rejectWarning: /Скорее всего, будет отказ|Такой отклик может получить отказ/i,
  forceApply: /Вс[её] равно откликнуться/i,
  attachLetter: /Приложить сопроводительное/i,
};

// Что разведка и запись проверяют на каждой странице: есть ли, видно ли, первые слова текста
export const WATCH = {
  applyButton: SEL.applyButton,
  modalSubmit: SEL.modalSubmit,
  letterInput: SEL.letterInput,
  letterToggle: SEL.letterToggle,
  resumeTitle: SEL.resumeTitle,
  hiddenResume: SEL.hiddenResume,
  attachLetter: SEL.attachLetter,
  letterInformer: SEL.letterInformer,
  letterSubmit: SEL.letterSubmit,
  success: SEL.success,
  viewTopic: SEL.viewTopic,
  relocationConfirm: SEL.relocationConfirm,
  questions: SEL.questions,
  taskTextarea: SEL.taskTextarea,
  loginForm: SEL.loginForm,
  captcha: SEL.captcha,
  dialog: SEL.dialog,
  negotiationsItem: SEL.negotiationsItem,
};

// Сетевой предохранитель: в сухом прогоне и разведке рвём всё, что может изменить аккаунт —
// не-GET запросы к /applicant/… и /shards/applicant/… (отклик, правки) и любые не-GET в chatik (сообщения,
// «прочитано»). Переход документом на /applicant/vacancy_response (адрес кнопки «Откликнуться») — только в журнал
export const GUARD_URL = /^https:\/\/(?:[a-z0-9-]+\.)*hh\.ru\/(?:applicant|shards\/applicant)\/|^https:\/\/chatik\.hh\.ru\//;
export const RESPONSE_PAGE = /\/applicant\/vacancy_response(?!\/popup)/;
