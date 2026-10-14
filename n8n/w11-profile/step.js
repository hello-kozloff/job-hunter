// W11 · Step — шаг онбординга и правки профиля (13.10.2026, docs/onboarding.md).
// Нода: Code, режим «Run Once for All Items».
// Вход: «Job», «Plan», «Settings», static data и то, что выполнилось до: «PDF text», «Parse profile», «Estimate parse».
// Выход: { save: { имя: значение } | null, collect, view: { layout, text, b, messageId } | null, prompt: текст | null,
//          deleteIds: [], toast }
//   save — строки settings (upsert, ветка выше «Collect»: W1 должен увидеть новый профиль);
//   collect — сразу первый сбор (онбординг закончен);
//   view — панель: messageId — правим это сообщение, 0 — новое;
//   prompt — вопрос ForceReply (ответ придёт в W11 как op input).
// Онбординг (state.step): summary → gender (пол не указан в резюме) → signature → contact → tz → готово: профиль
// сохраняется целиком, profile.ready = true, первый сбор.
// Готовый профиль: ⚙️ → 👤 (view), правка одного поля сразу в settings, новое резюме (replace), правка нейросетью
// и «Всё заново» — через предпросмотр (review: ✅ Сохранить / ❌ Отмена).
// Static data (global): draft, estimate, text, pending { text, fileName }, step, mode, signature, contact, tz, panelId.

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

// @include n8n/shared/hh-roles.js

// @include n8n/shared/search.js

// @include n8n/shared/menu.js

// @include n8n/shared/profile.js

const job = $('Job').first().json;
const plan = $('Plan').first().json;
const s = loadSettings($('Settings').all());
const state = $getWorkflowStaticData('global');
const ready = s['profile.ready'];
const frontend = s['profile.preset'] === 'frontend';
const now = Date.now();
const ran = (name) => {
  try {
    return $(name).first().json;
  } catch {
    return null; // нода в этом запуске не выполнялась
  }
};

const out = { save: null, collect: false, view: null, prompt: null, deleteIds: [], toast: '', freeze: null };
// Панель — сообщение с нажатой кнопкой; новый PDF — «📄 Читаю резюме…»; ответ на вопрос — панель из static data
const panelId = job.messageId || ran('Reading')?.result?.message_id || state.panelId || 0;
const show = (layout, text, b = {}) => {
  out.view = { layout, text, b, messageId: panelId };
};
const clear = () => {
  for (const key of ['draft', 'estimate', 'text', 'pending', 'step', 'mode', 'signature', 'contact', 'tz']) delete state[key];
};
if (job.op === 'input') out.deleteIds = [job.userMessageId, job.promptId].filter(Boolean);

// ---------- Виды ----------

const facts = () => state.draft?.facts ?? s['profile.facts'];
const signatureNow = () => state.signature ?? facts().first_name ?? '';
const contactNow = () => state.contact ?? defaultContact(facts(), job.username);
const tzNow = () => state.tz ?? TZ;

const summaryText = () => ['📄 <b>Вот что я понял из резюме</b>', '', profileSummary(state.draft, state.estimate ?? [])].join('\n');
function summaryView(note = '') {
  show('pf summary', `${summaryText()}\n\n${note || 'Всё верно? Если нет — «✏️ Поправить» и напиши словами, что не так.'}`);
}
function genderView() {
  show('pf gender', 'В резюме пол не указан, а письма пишутся от первого лица. Как писать о себе: «делал» или «делала»?');
}
function signatureView() {
  show('pf signature', `✍️ Подпись в письмах: <b>${esc(signatureNow() || '—')}</b>`);
}
function contactView() {
  const c = contactNow();
  show('pf contact', c ? `📇 Контакт для HR — последняя строка письма:\n<b>${esc(c)}</b>` : '📇 Контакта для HR в резюме нет — письма будут без него. «✏️ Другой» — добавить.');
}
function tzView(note = '') {
  const tz = tzNow();
  show(
    'pf tz',
    [
      `🕐 Часовой пояс: <b>${esc(tz)}</b> (${tzLabel(tz)}), сейчас ${localHM(now, tz)}`,
      'От него зависят тихие часы (23–09 — без звука), утренняя сводка в 10:00 и время в боте.',
      note,
    ]
      .filter(Boolean)
      .join('\n'),
    { tz: { text: `✅ ${tzLabel(tz)}, сейчас ${localHM(now, tz)}` } },
  );
}
function profileView(note = '') {
  const f = s['profile.facts'];
  const r = s['llm.rules'];
  const extra = s['profile.extra'];
  const lines = [
    '👤 <b>Профиль</b>',
    '',
    f.name || f.position ? `${esc(f.name || '—')} · ${esc(f.position || '—')}${f.years ? ` · ${f.years} г.` : ''}` : null,
    `🔎 ${esc(describeSearch(s).filters)}`,
    `• в названии: ${esc(s['search.in_name'].join(' · ') || '—')}${s['search.anywhere'].length ? ` · везде: ${esc(s['search.anywhere'].join(' · '))}` : ''}`,
    frontend
      ? '📜 Правила: пресет «Фронтенд» — откалиброваны вручную, в коде'
      : `📜 Правила: 🟢 ${r.apply?.length ?? 0} · 🟡 ${r.maybe?.length ?? 0} · 🔴 ${r.skip?.length ?? 0}`,
    `✍️ Подпись: ${esc(s['profile.signature'] || '—')} · 📇 ${esc(s['profile.contact'] || 'контакта нет')}`,
    `🕐 ${esc(TZ)} (${tzLabel(TZ)}), сейчас ${localHM(now)}`,
    `📄 Резюме: ${s['profile.resume'].length} знаков · ➕ дополнительно: ${extra ? `${extra.length} знаков` : 'нет'} · ✉️ образцы писем: ${s['letters.examples'] ? 'есть' : 'нет'}`,
    '',
    'Новое резюме — просто пришли PDF в чат. «✏️ Поправить» — напиши словами, что изменить.',
    note ? `\n${note}` : null,
  ];
  show('pf profile', lines.filter((l) => l !== null).join('\n'));
}
function reviewView(note) {
  show('pf review', [note, '', profileSummary(state.draft, state.estimate ?? []), '', 'Сохранить?'].join('\n'));
}
function plain(text, newMessage = false) {
  out.view = { layout: 'pf plain', text, b: {}, messageId: newMessage ? 0 : panelId };
}

// ---------- Вопросы (ForceReply) ----------

const PROMPT_HELP = {
  profile: 'Напиши словами, например: «английский B2», «ищу только удалёнку», «главбух мне тоже подходит».',
  signature: () => `Как подписывать письма. Сейчас: ${signatureNow() || '—'}`,
  contact: () => `Строка в конце письма, например «Для быстрой связи тг: @ivan» или «Почта: ivan@mail.ru». Сейчас: ${contactNow() || '—'}`,
  tz: 'Пришли город («Белград», «Алматы») или смещение («UTC+2»).',
  extra: () => `То, чего нет в PDF: свои проекты, фриланс, подработки. Заменит прежний текст, «-» — убрать. Сейчас: ${s['profile.extra'] ? `${s['profile.extra'].length} знаков` : 'нет'}`,
  examples: () => `1–3 своих сопроводительных письма одним сообщением — бот будет писать в их стиле. «-» — убрать. Сейчас: ${s['letters.examples'] ? 'есть' : 'нет'}`,
};
function ask(field) {
  if (!PROFILE_PROMPTS[field]) return;
  const help = typeof PROMPT_HELP[field] === 'function' ? PROMPT_HELP[field]() : PROMPT_HELP[field];
  out.prompt = `${PROFILE_PROMPTS[field]}\n${help}\nОтветь на это сообщение.`;
}

// ---------- Онбординг ----------

const STEPS = ['summary', 'gender', 'signature', 'contact', 'tz'];
function showStep() {
  ({ summary: summaryView, gender: genderView, signature: signatureView, contact: contactView, tz: tzView })[state.step]?.();
}
function nextStep() {
  // Сводка остаётся в чате (14.10.2026: иначе её затирали следующие шаги и предупреждения было не видно) — без кнопок,
  // а шаги идут новой панелью
  if (state.step === 'summary') {
    out.freeze = { messageId: panelId, text: `${summaryText()}\n\n✅ Подтверждено` };
    state.step = state.draft.facts.gender ? 'signature' : 'gender';
    showStep();
    out.view.messageId = 0;
    return;
  }
  else if (state.step === 'gender') state.step = 'signature';
  else if (state.step === 'signature') state.step = 'contact';
  else if (state.step === 'contact') state.step = 'tz';
  else if (state.step === 'tz') return finish();
  showStep();
}
function finish() {
  const tz = tzNow();
  out.save = {
    ...profileRows(state.draft, { resume: state.text, signature: signatureNow(), contact: contactNow(), tz }),
    'profile.ready': true,
    // Первый поиск — без карточек, одним итогом (W2)
    'profile.first_quiet': true,
  };
  out.collect = true;
  clear();
  plain(
    [
      '✅ <b>Готово!</b> Профиль сохранён.',
      '',
      '⏳ <b>Идёт первый поиск</b> — обычно 5–15 минут: открываю страницы вакансий и оцениваю их нейросетью. Карточки по одной слать не буду — пришлю одно сообщение с итогом, а вакансии будут в 📋 Вакансии.',
      '',
      'Дальше новые вакансии приходят карточками: ✅ откликнусь (бот напишет письмо) · 🤔 возможно · ❌ мимо. Если не согласен с нейросетью, бот спросит «Почему?» — так правила становятся точнее.',
      'Профиль, поиск и правила — ⚙️ Настройки → 👤 Профиль.',
    ].join('\n'),
  );
}
const onboarding = !ready && state.mode === 'onboarding' && state.draft && STEPS.includes(state.step);

// Сохранить одно поле готового профиля (или запомнить его в онбординге и пойти дальше)
function setField(field, value) {
  if (onboarding) {
    if (field === 'gender') state.draft.facts.gender = value;
    else state[field] = value;
    return nextStep();
  }
  const name = { signature: 'profile.signature', contact: 'profile.contact', tz: 'profile.tz', extra: 'profile.extra', examples: 'letters.examples' }[field];
  if (field === 'gender') out.save = { 'profile.facts': { ...s['profile.facts'], gender: value } };
  else if (name) out.save = { [name]: value };
  // Показать уже новое значение
  if (out.save) Object.assign(s, out.save);
  profileView('✅ Записал');
}

// ---------- Что пришло ----------

const pdf = ran('PDF text');
const parsed = ran('Parse profile');
const estimated = ran('Estimate parse');
const extractMode = ran('Build extract')?.mode;

if (plan.problem) {
  plain(`⚠️ ${esc(plan.problem)}`, true);
} else if (job.op === 'not_pdf') {
  plain('📎 Это не PDF. Пришли резюме в PDF: на hh — «Мои резюме» → резюме → «Скачать» → PDF.', true);
} else if (pdf?.problem) {
  plain(`⚠️ ${esc(pdf.problem)}`);
} else if (pdf?.replace) {
  state.panelId = panelId;
  if (frontend) {
    show('pf replace text', `📄 Новое резюме${state.pending?.fileName ? ` «${esc(state.pending.fileName)}»` : ''}.\nУ тебя пресет «Фронтенд»: поиск и правила настроены вручную — обновлю только текст резюме.`);
  } else {
    show(
      'pf replace',
      [
        `📄 Новое резюме${state.pending?.fileName ? ` «${esc(state.pending.fileName)}»` : ''}.`,
        '🔄 <b>Всё заново</b> — разберу его и пересоберу поиск и правила; подпись, контакт, пояс, письма и чёрный список останутся.',
        '📄 <b>Только текст</b> — заменю текст резюме, остальное не трогаю.',
      ].join('\n'),
    );
  }
} else if (parsed && !parsed.ok) {
  // Нейросеть не справилась: в онбординге — прислать PDF ещё раз, в правке — показать прежний черновик
  if (extractMode === 'revise' && state.draft && state.step) {
    if (onboarding) summaryView(`⚠️ Не вышло поправить: ${esc(parsed.problem)}. Попробуй сформулировать иначе.`);
    else reviewView(`⚠️ Не вышло поправить: ${esc(parsed.problem)}.`);
  } else {
    plain(`⚠️ ${esc(parsed.problem)}${ready ? '' : '\n\nПришли PDF ещё раз.'}`);
  }
} else if (parsed?.ok) {
  state.draft = estimated?.draft ?? parsed.draft;
  state.estimate = estimated?.estimate ?? [];
  state.panelId = panelId;
  if (!ready) {
    state.mode = 'onboarding';
    state.step = 'summary';
    summaryView(extractMode === 'revise' ? '✏️ Поправил. Всё верно? Если нет — «✏️ Поправить» ещё раз.' : '');
  } else {
    state.mode = extractMode === 'revise' ? 'revise' : 'replace';
    state.step = 'review';
    reviewView(
      extractMode === 'revise'
        ? '✏️ <b>Поправил профиль</b>. Подпись, контакт, пояс и письма — без изменений.'
        : '📄 <b>Новое резюме разобрано.</b> Подпись, контакт, пояс, письма и чёрный список останутся прежними.',
    );
  }
} else if (job.op === 'view') {
  profileView();
} else if (job.op === 'ok') {
  // В кнопке — шаг, на котором её показали: двойное нажатие или старая панель не перескочат шаг
  if (onboarding && (!job.value || job.value === state.step)) nextStep();
  else if (onboarding) showStep();
  else profileView();
} else if (job.op === 'set' && job.field === 'gender' && ['m', 'f'].includes(job.value)) {
  setField('gender', job.value);
} else if (job.op === 'set' && job.field === 'tz' && validTz(job.value)) {
  setField('tz', job.value);
} else if (job.op === 'ask') {
  ask(job.field);
  out.toast = '✏️ Ответь на сообщение ниже';
} else if (job.op === 'input') {
  const text = job.text.trim();
  if (job.field === 'signature') setField('signature', clip(text, 60));
  else if (job.field === 'contact') setField('contact', clip(text, 160));
  else if (job.field === 'tz') {
    const tz = parseTz(text);
    if (tz) setField('tz', tz);
    else if (onboarding) tzView(`⚠️ Не понял «${esc(clip(text, 40))}». Пришли город или смещение вида UTC+2.`);
    else profileView(`⚠️ Не понял часовой пояс «${esc(clip(text, 40))}». Пришли город или смещение вида UTC+2.`);
  } else if (job.field === 'extra') setField('extra', text === '-' ? '' : text.slice(0, 4000));
  else if (job.field === 'examples') setField('examples', text === '-' ? '' : text.slice(0, 4000));
} else if (job.op === 'replace') {
  if (job.value === 'text' && state.pending?.text) {
    out.save = { 'profile.resume': state.pending.text };
    Object.assign(s, out.save);
    clear();
    profileView('✅ Текст резюме обновлён');
  } else {
    clear();
    profileView(job.value === 'no' ? 'Новое резюме не сохранил.' : '');
  }
} else if (job.op === 'confirm') {
  if (job.value === 'yes' && state.draft && ['replace', 'revise'].includes(state.mode)) {
    if (frontend) {
      // Пресет frontend: правила и поиск — в коде и настройках владельца, из правки берём только факты и «О кандидате»
      out.save = { 'profile.facts': state.draft.facts, 'profile.about': state.draft.about };
    } else {
      out.save = profileRows(state.draft, {
        resume: state.mode === 'replace' ? state.pending?.text ?? s['profile.resume'] : s['profile.resume'],
        signature: s['profile.signature'],
        contact: s['profile.contact'],
        tz: s['profile.tz'] || TZ,
      });
      // Свои спорные случаи человек вписал сам — новое резюме их не стирает
      delete out.save['llm.cases'];
    }
    Object.assign(s, out.save);
    clear();
    profileView('✅ Сохранил');
  } else {
    clear();
    profileView('Отменил — профиль прежний.');
  }
} else {
  profileView();
}

return [{ json: out }];
