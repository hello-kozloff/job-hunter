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

// Опция списка резюме в окне отклика — по хешу резюме
export const resumeOptionSel = (hash) => `[data-qa="magritte-select-option-${hash}"]`;
// Сообщение в чате отклика — по id сообщения hh (запись 28.10.2026: пузырь chatik-chat-message-<id>, его текст —
// chatik-chat-message-<id>-text; data-qa с несколькими значениями через пробел)
export const chatMessageSel = (id) => `[data-qa~="chatik-chat-message-${id}"]`;

export const SEL = {
  // Страница вакансии
  applyButton: '[data-qa="vacancy-response-link-top"]',
  description: '[data-qa="vacancy-description"]',
  // Окно отклика: письмо до отправки
  modalSubmit: '[data-qa="vacancy-response-submit-popup"]',
  letterInput: '[data-qa="vacancy-response-popup-form-letter-input"]',
  // Поле письма свёрнуто, когда письмо необязательно: с 19.10.2026 (разведка окна) — кнопка «Добавить сопроводительное»
  // в подвале окна (add-cover-letter); до того — vacancy-response-letter-toggle. Обязательное письмо — поле сразу
  letterToggle: '[data-qa="add-cover-letter"], [data-qa="vacancy-response-letter-toggle"]',
  resumeTitle: '[data-qa="resume-title"]',
  // Выбор резюме в окне (запись 16.10.2026, два резюме): ячейка с названием — кнопка (role=button), по нажатию — список
  // опций magritte-select-option-<хеш резюме> (radio). Название в самом окне — resume-title вне списка (в списке свои)
  resumeCurrent: 'xpath=(//*[@data-qa="resume-title"][not(ancestor::*[@role="listbox"])])[1]',
  resumeCell: 'xpath=(//*[@data-qa="resume-title"][not(ancestor::*[@role="listbox"])])[1]/ancestor::*[@role="button"][1]',
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
  // Чат отклика (iframe chatik.hh.ru/chat/<id>, запись 10.10.2026): у сообщения отклика «⊕ Добавить
  // сопроводительное» → поле письма → «Отправить» → POST chatik/api/save — письмо встаёт в само сообщение отклика
  chatAddLetter: '[data-qa="chatik-chat-message-applicant-action"]',
  // Поле сообщения (и письма в 6.1b): textarea text-input внутри chatik-message-input; «Отправить» появляется после
  // набора (запись 28.10.2026, напоминание 6.3); тексты сообщений — chatik-chat-message-<id>-text
  chatText: 'textarea[data-qa="text-input"], [data-qa="text-input"] textarea, [data-qa="chatik-message-input"] textarea',
  chatSend: '[data-qa="chatik-do-send-message"]',
  chatMessageText: '[data-qa*="chatik-chat-message-"][data-qa$="-text"]',
  // Вход и капча — только по структуре: слово «captcha» есть и на обычных страницах (CLAUDE.md §8.1)
  loginForm: '[data-qa="account-login-form"]',
  captcha: 'form[action*="/account/captcha"], input[name="captchaText"], iframe[src*="smartcaptcha"]',
  captchaForm: 'form[action*="/account/captcha"]',
  captchaInput: 'input[name="captchaText"]',
  captchaSubmit: 'form[action*="/account/captcha"] [type="submit"]',
  smartCaptcha: 'iframe[src*="smartcaptcha"]',
  captchaImage: 'form[action*="/account/captcha"] img, img[src*="captcha"]',
  // Отклики
  negotiationsItem: '[data-qa="negotiations-item"]',
  // Формы резюме (часть D, запись E0 15.10.2026): должность, ключевые навыки, «О себе» — /resume/edit/<hash>/…,
  // место работы — /profile/edit/experience/<id> (профиль: общий для всех резюме, где место отмечено)
  cvTitle: 'input[data-qa="resume-edit-title-suggest"]',
  cvAbout: 'textarea[data-qa="resume-editor-about"]',
  cvSkillInput: 'input[data-qa="chips-trigger-input"]',
  cvSkillChip: '[data-qa^="chips-trigger-chip-"]',
  cvSkillDelete: '[data-qa="chip-delete-action"]',
  cvSkillUserItem: '[data-qa="suggest-item-user-input"]',
  cvSave: '[data-qa="resume-partial-edit-save"]',
  cvPlacePosition: 'input[name="position"]',
  cvPlaceDescription: 'textarea[data-qa="resume-editor-experience-description-input"]',
  cvPlaceSave: '[data-qa="profile-layout-save-button"]',
  dialog: '[role="dialog"], [role="alertdialog"]',
};

// Тексты-маркеры — дословно из переводов hh (InitialState → trl.RU / trl.EN). Язык сайта hh меняет сам: 10.10.2026
// у робота был русский, 11.10.2026 — английский (locale.siteLanguage = EN), поэтому каждый маркер — на обоих языках
export const TEXT = {
  // negotiationsLimitExceeded.error
  limit: /не более \d+ откликов|исчерпали лимит откликов|more than \d+ applications per 24|reached your application limit/i,
  // alreadyResponded.*.short, alreadyApplied.error, responded.success.title
  responded:
    /Вы откликнулись|Вы уже откликались|Резюме доставлено|Вас пригласили|You applied|already applied for this vacancy|You have been invited/i,
  // letter.viewed
  viewed: /Отклик уже просмотрен работодателем|response has been viewed by the employer/i,
  // test.error
  test: /требуется ответить на вопросы теста|must answer the questions of the test/i,
  // hidden.resumes.formatted (в EN не переведён), changeResumeVisibilityDenied.error
  hidden: /поменяйте видимость резюме|с текущей видимостью резюме|current resume visibility settings/i,
  // resourcePolicyViolation, spamDetected, inappropriateLanguage — дальше не отправляем, зовём человека
  // (в чате — chatik.sendMessage.errors.*: EN spamDetected — «Inappropriate message», 28.10.2026)
  stop: /нарушает правила сервиса|Недопустимое сообщение|уберите нецензурные слова|violation of the service rules|Invalid message|Inappropriate message|remove the obscene words/i,
  // unknown.error, testServiceDown.error, tooLongLetter, letter.tooLong
  failed:
    /Произошла ошибка|сайт перегружен|Отклик не был доставлен|Превышен лимит символов|не может превышать \d+ символов|An error occurred|site is overloaded|Character limit exceeded|must not be longer than \d+ characters/i,
  // vacancy.respond.popup.title (+ force — «Все равно откликнуться»)
  relocation: /Вы откликаетесь на вакансию в другой стране|applying from another country/i,
  // vacancy.respond.popup.message, inconsistency.title
  rejectWarning: /Скорее всего, будет отказ|Такой отклик может получить отказ|most likely be rejected|may get rejected/i,
  forceApply: /Вс[её] равно откликнуться|Still apply/i,
  // otherCountriesProfileVisibilityAgreement.title.* / .agree — открыть профиль работодателям страны вакансии
  // (решение пользователя 11.10.2026: нажимать, страну — в отчёт); страна — первая группа
  otherCountries: /разрешите работодателям из (.+?) видеть ваш профиль|allow employers from (.+?) to see your profile/i,
  allowCountries: /Разрешить и продолжить|Allow and continue/i,
  // letter.informer.attachLetter, responded.success.attachCoverLetter
  attachLetter: /Приложить сопроводительное|Add a cover letter/i,
  // Чат отклика: действие у сообщения отклика без письма (запись 10.10.2026; переводы чата — в самом чате, EN — по
  // образцу letter.button.add «Add cover letter»)
  addLetter: /Добавить сопроводительное|Add (?:a )?cover(?:ing)? letter/i,
  // Писать в чат нельзя (chatik.warning.*, 28.10.2026): работодатель отключил переписку, только после приглашения,
  // «не можете писать», 5 сообщений подряд без ответа, лимит сообщений, вакансия в архиве или недоступна
  chatClosed:
    /Работодатель отключил переписку|employer has turned off the chat|Переписка будет доступна после приглашения|Chat will be available after the employer|Вы не можете писать в чат|You cannot send messages to the chat|Вы отправили 5 сообщений подряд|sent 5 messages in a row|ограничение по общему количеству сообщений|limit on the total number of messages|была перенесена в архив|has been archived|Вакансия недоступна|Vacancy not available/i,
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
// не-GET запросы к /applicant/… и /shards/applicant/… (отклик, правки резюме), любые не-GET в chatik (сообщения,
// «прочитано») и в resume-profile-front (сохранение опыта работы — общего для всех резюме, E0 15.10.2026).
// Переход документом на /applicant/vacancy_response (адрес кнопки «Откликнуться») — только в журнал
export const GUARD_URL =
  /^https:\/\/(?:[a-z0-9-]+\.)*hh\.ru\/(?:applicant|shards\/applicant)\/|^https:\/\/chatik\.hh\.ru\/|^https:\/\/resume-profile-front\.hh\.ru\//;
export const RESPONSE_PAGE = /\/applicant\/vacancy_response(?!\/popup)/;
// Клик по «Откликнуться» у вакансии «в один клик» — это GET /applicant/vacancy_response → 302 на
// /vacancy/<id>?forceQuickResponse=true, и страница сама шлёт POST отклика (запись 10.10.2026).
// В сухом прогоне и разведке такой переход рвём ещё до POST
export const FORCE_QUICK = /[?&]forceQuickResponse=true/;
export const FORCE_QUICK_URL = /^https:\/\/(?:[a-z0-9-]+\.)*hh\.ru\/vacancy\/\d+\?/;

// Действия живого отклика (запись 10.10.2026) — имя → адреса. Предохранитель пропускает не-GET только к адресам
// действий, которые сценарий открыл (browser.mjs → guardAllow), сетевой журнал отклика ловит их ответы (flows/net.mjs):
//   respond   POST /applicant/vacancy_response/popup — сам отклик (окно «Откликнуться» и отклик в один клик)
//   letter    POST /applicant/vacancy_response/edit_ajax — «Приложить сопроводительное письмо» после отклика
//   chat      POST chatik/api/save — письмо в сообщение отклика в чате; notify_chat_opened — чат открыт
//   remind    POST chatik/api/send — новое сообщение в чат отклика (напоминание 6.3, запись 28.10.2026: {chatId,
//             idempotencyKey, text} → само сообщение); notify_chat_opened; participant_action — «печатает…» при наборе
//   resume    POST /applicant/resume/edit?resume=<hash> — сохранение формы резюме: должность, навыки, «О себе» (E0)
//   profile   POST resume-profile-front…/profile/shards/profile/update — сохранение опыта работы (профиль, E0)
// quick — не адрес, а разрешение перехода на /vacancy/<id>?forceQuickResponse=true (FORCE_QUICK выше)
export const ACTION_URL = {
  respond: /^https:\/\/(?:[a-z0-9-]+\.)*hh\.ru\/applicant\/vacancy_response\/popup(?:[?#]|$)/,
  letter: /^https:\/\/(?:[a-z0-9-]+\.)*hh\.ru\/applicant\/vacancy_response\/edit_ajax(?:[?#]|$)/,
  chat: /^https:\/\/chatik\.hh\.ru\/chatik\/api\/save(?:[?#]|$)/,
  chatOpened: /^https:\/\/chatik\.hh\.ru\/chatik\/api\/notify_chat_opened(?:[?#]|$)/,
  chatSend: /^https:\/\/chatik\.hh\.ru\/chatik\/api\/send(?:[?#]|$)/,
  chatTyping: /^https:\/\/chatik\.hh\.ru\/chatik\/api\/participant_action(?:[?#]|$)/,
  resume: /^https:\/\/(?:[a-z0-9-]+\.)*hh\.ru\/applicant\/resume\/edit(?:[?#]|$)/,
  profile: /^https:\/\/resume-profile-front\.hh\.ru\/profile\/shards\/profile\/update(?:[?#]|$)/,
};
export const GUARD_ALLOW = {
  respond: [ACTION_URL.respond],
  letter: [ACTION_URL.letter],
  chat: [ACTION_URL.chat, ACTION_URL.chatOpened],
  remind: [ACTION_URL.chatSend, ACTION_URL.chatOpened, ACTION_URL.chatTyping],
  resume: [ACTION_URL.resume],
  profile: [ACTION_URL.profile],
};
// Кадр чата отклика (iframe виджета чатов на странице вакансии или отдельная вкладка)
export const CHAT_FRAME = /^https:\/\/chatik\.hh\.ru\/chat\/\d+/;
// Данные чата, которые грузит сам кадр (GET): можно ли писать, сообщения
export const CHAT_DATA_URL = /^https:\/\/chatik\.hh\.ru\/chatik\/api\/chat_data(?:[?#]|$)/;
// Страница hh (а не сайт работодателя): клик «Откликнуться» увёл с hh → отклик на внешнем сайте
export const HH_PAGE = /^https:\/\/(?:[a-z0-9-]+\.)*hh\.ru(?:[/:?#]|$)/;
