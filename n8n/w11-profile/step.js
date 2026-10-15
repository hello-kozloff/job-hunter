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
// Несколько резюме (docs/resumes.md): ⚙️ → 📄 Резюме — список, карточка резюме (rm:o:<id>), включить и выключить поиск,
// название, копия, удаление, новое резюме (PDF или текст) и новый текст. Правка, дополнение и образцы писем в карточке
// пишут в resume.<id> (n8n/shared/resumes.js → resumeRows), у основного резюме (r1) — прежние глобальные ключи.
// Static data (global): draft, estimate, text, pending { text, fileName, target }, step, mode (onboarding | replace | revise
// | create), signature, contact, tz, panelId; target — резюме, чью карточку открыли ('' — основное);
// await { kind: create | replace, id, at } — ждём PDF («➕ Новое резюме», «📄 Заменить текст»).

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

// @include n8n/shared/resumes.js

// @include n8n/shared/hh-roles.js

// @include n8n/shared/search.js

// @include n8n/shared/menu.js

// @include n8n/shared/profile.js

const job = $('Job').first().json;
const plan = $('Plan').first().json;
const s = loadSettings($('Settings').all());
const state = $getWorkflowStaticData('global');
// ⚙️ → 👤 открывает основное резюме: цель правок сбрасывается
if (job.op === 'view') {
  delete state.target;
  delete state.await;
}
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
// Вопрос и ответ человека убираем из чата, кроме текста нового резюме с ошибкой: его не жалко вставить заново, но
// и не нужно стирать, пока не ясно, дошёл ли он до нейросети (проблему Plan показывает до этого шага)
if (job.op === 'input' && !(job.field === 'newresume' && plan.problem)) {
  out.deleteIds = [job.userMessageId, job.promptId].filter(Boolean);
}

// Резюме, чью карточку открыли: '' — основное. Настройки резюме (с подменой полей) — resumeSettings
const targetNow = () => (state.target && state.target !== 'r1' && resumeById(s, state.target) ? state.target : '');
const rsOf = (id) => resumeSettings(s, id || 'r1');
// Записать и сразу учесть в s: следующий экран покажет новые значения
const apply = (save) => {
  out.save = { ...(out.save ?? {}), ...save };
  Object.assign(s, save);
};

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
    resumeList(s).length > 1 ? `📚 Всего резюме: ${resumeList(s).length}, ищут ${activeResumes(s).length} — кнопка «📄 Резюме»` : null,
    '',
    'Новое резюме — просто пришли PDF в чат. «✏️ Поправить» — напиши словами, что изменить.',
    note ? `\n${note}` : null,
  ];
  show('pf profile', lines.filter((l) => l !== null).join('\n'));
}
// Несколько резюме: список, карточка, удаление, ожидание файла (раскладки rm … в scripts/build-workflows.mjs)
const wordsOf = (rs) => [...rs['search.in_name'], ...rs['search.anywhere']].slice(0, 5).join(' · ') || '—';
function listView(note = '') {
  const list = resumeList(s);
  const lines = [
    `📄 <b>Резюме</b> (${list.length} из ${MAX_RESUMES})`,
    '',
    ...list.map((r) => `${r.active ? '🟢' : '⏸'} <b>${esc(r.name)}</b>${r.id === 'r1' ? ' · основное' : ''}${r.hh ? ' · 🔗 hh' : ''}\n    ${esc(wordsOf(rsOf(r.id)))}`),
    '',
    `Поиск идёт по каждому включённому резюме (до ${MAX_SEARCH_RESUMES} за сбор). Если вакансию нашли два резюме, она достаётся первому в списке. Оценка нейросетью и письмо — по резюме вакансии. Подпись, контакт, часовой пояс и чёрный список — общие: ⚙️ → 👤 Профиль.`,
    note ? `\n${note}` : null,
  ];
  const b = {};
  list.forEach((r, i) => {
    b[`r${i}`] = { text: `${r.active ? '🟢' : '⏸'} ${r.name}`, cb: `rm:o:${r.id}` };
    // Включить и выключить поиск прямо из списка (l — вернуться к списку)
    b[`t${i}`] = { text: r.active ? '⏸' : '▶️', cb: `rm:${r.active ? 'off' : 'on'}:${r.id}:l` };
  });
  show(`rm list${list.length}`, lines.filter((l) => l !== null).join('\n'), b);
}
function cardView(id, note = '') {
  const r = resumeById(s, id);
  if (!r) return listView('⚠️ Такого резюме нет');
  const rs = rsOf(id);
  const f = rs['profile.facts'];
  const rules = rs['llm.rules'];
  const lines = [
    `📄 <b>${esc(r.name)}</b> · ${r.active ? '🟢 поиск включён' : '⏸ поиск выключен'}`,
    '',
    f.position ? `${esc(f.position)}${f.years ? ` · ${f.years} г.` : ''}` : null,
    `🔎 ${esc(describeSearch(rs).filters)}`,
    `• в названии: ${esc(rs['search.in_name'].join(' · ') || '—')}${rs['search.anywhere'].length ? ` · везде: ${esc(rs['search.anywhere'].join(' · '))}` : ''}`,
    rs['filter.stop_words'].length ? `• мимо, если в названии: ${esc(rs['filter.stop_words'].join(' · '))}` : null,
    `📜 Правила: 🟢 ${rules.apply?.length ?? 0} · 🟡 ${rules.maybe?.length ?? 0} · 🔴 ${rules.skip?.length ?? 0}`,
    `📄 Текст: ${rs['profile.resume'].length} знаков · ➕ дополнительно: ${rs['profile.extra'] ? `${rs['profile.extra'].length} знаков` : 'нет'} · ✉️ образцы писем: ${rs['letters.examples'] ? 'есть' : 'нет'}`,
    r.hh ? `🔗 hh: «${esc(r.hh.title)}»` : '🔗 hh: не привязано',
    '',
    'Подпись, контакт и пояс — общие, в ⚙️ → 👤 Профиль. «✏️ Поправить» — напиши словами, что изменить в поиске и правилах этого резюме.',
    note ? `\n${note}` : null,
  ];
  show('rm card', lines.filter((l) => l !== null).join('\n'), {
    toggle: { text: r.active ? '⏸ Выключить поиск' : '▶️ Включить поиск', cb: `rm:${r.active ? 'off' : 'on'}:${id}` },
    ren: `rm:ren:${id}`,
    txt: `rm:txt:${id}`,
    clone: `rm:clone:${id}`,
    del: `rm:del:${id}`,
  });
}
function deleteView(id) {
  const r = resumeById(s, id);
  show('rm delete', `🗑 <b>Удалить резюме «${esc(r?.name ?? id)}»?</b>\nВакансии, которые оно нашло, останутся в списке; оценка и письма по ним пойдут по основному резюме.`, {
    yes: `rm:del:${id}:y`,
    no: `rm:o:${id}`,
  });
}
// Основное резюме — прежняя панель профиля, остальные — карточка
const home = (note = '') => (targetNow() ? cardView(targetNow(), note) : profileView(note));
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
  extra: () => `То, чего нет в PDF: свои проекты, фриланс, подработки. Заменит прежний текст, «-» — убрать. Сейчас: ${rsOf(targetNow())['profile.extra'] ? `${rsOf(targetNow())['profile.extra'].length} знаков` : 'нет'}`,
  examples: () => `1–3 своих сопроводительных письма одним сообщением — бот будет писать в их стиле. «-» — убрать. Сейчас: ${rsOf(targetNow())['letters.examples'] ? 'есть' : 'нет'}`,
  rname: () => `Как назвать резюме (до 60 знаков), например «Дизайнер» или «Бухгалтер». Сейчас: ${resumeById(s, targetNow())?.name ?? '—'}`,
  newresume: 'Пришли резюме PDF-файлом (на hh: «Мои резюме» → резюме → «Скачать» → PDF) или вставь его текст сюда, ответом на это сообщение. Telegram принимает текст до 4096 знаков, длиннее — только PDF.',
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
  // «Дополнить» и «Образцы писем» — своё у каждого резюме; подпись, контакт и пояс — общие
  if (targetNow() && ['extra', 'examples'].includes(field)) apply(resumeRows(s, targetNow(), { [field]: value }));
  else if (field === 'gender') apply({ 'profile.facts': { ...s['profile.facts'], gender: value } });
  else if (name) apply({ [name]: value });
  home('✅ Записал');
}

// ---------- Что пришло ----------

const pdf = ran('PDF text');
const parsed = ran('Parse profile');
const estimated = ran('Estimate parse');
const extractMode = ran('Build extract')?.mode;

// ---------- Операции с резюме (⚙️ → 📄 Резюме) ----------

const RM_ID = /^r[1-5]$/;
// Название без повторов: «Дизайнер», «Дизайнер 2»
function uniqueName(name, list) {
  const taken = new Set(list.map((r) => r.name.toLowerCase()));
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} ${n}`;
  return candidate;
}
const limitNote = `⚠️ Уже ${MAX_RESUMES} резюме — это предел. Удали ненужное.`;

// Новое резюме из разобранного черновика: свой поиск, свои правила, пол, город и имя — как у основного (parse-profile)
function saveNewResume() {
  const id = nextResumeId(s);
  if (!id) {
    clear();
    return listView(limitNote);
  }
  if (!state.text) {
    clear();
    return plain('⚠️ Потерял текст резюме — пришли PDF ещё раз: «➕ Новое резюме».');
  }
  const list = resumeList(s);
  const name = uniqueName(clip(state.draft.facts.position || `Резюме ${id.slice(1)}`, 60), list);
  apply({
    resumes: [...list, { id, name, active: true, hh: null }],
    [`resume.${id}`]: resumeFromDraft(state.draft, { resume: state.text, tz: s['profile.tz'] || TZ }),
  });
  clear();
  state.target = id;
  cardView(id, '✅ Резюме создано, поиск включён: первый сбор по нему — в ближайшие полчаса, придут карточки за последние сутки. Поправить поиск и правила — «✏️ Поправить».');
}

// Правка или новый текст не основного резюме: пишем в resume.<id>, подпись, контакт и пояс не трогаем;
// дополнение, образцы писем, стиль писем и свои спорные случаи правка черновика не стирает
function saveResumeEdit(id) {
  const rs = rsOf(id);
  const text = state.mode === 'replace' ? (state.pending?.text ?? rs['profile.resume']) : rs['profile.resume'];
  apply(
    resumeRows(
      s,
      id,
      resumeFromDraft(state.draft, {
        resume: text,
        tz: s['profile.tz'] || TZ,
        keep: { extra: rs['profile.extra'], examples: rs['letters.examples'], prompt: rs['letters.prompt'], cases: rs['llm.cases'] },
      }),
    ),
  );
  clear();
  state.target = id;
  cardView(id, '✅ Сохранил');
}

// rm:<действие>[:<id>[:<y|l>]] — W3 «Route» кладёт действие в job.field, остальное в job.value
function rmOp() {
  const [id = '', arg = ''] = job.value.split(':');
  const list = resumeList(s);
  const known = RM_ID.test(id) && list.some((r) => r.id === id);
  const name = resumeById(s, id)?.name ?? id;
  state.panelId = panelId;
  switch (job.field) {
    case 'list':
      delete state.await;
      delete state.target;
      return listView();
    case 'o':
      if (!known) return listView('⚠️ Такого резюме нет');
      delete state.await;
      if (id === 'r1') {
        delete state.target;
        return profileView();
      }
      state.target = id;
      return cardView(id);
    case 'on':
    case 'off': {
      if (!known) return listView('⚠️ Такого резюме нет');
      const next = list.map((r) => (r.id === id ? { ...r, active: job.field === 'on' } : r));
      const back = (note) => {
        if (arg === 'l') return listView(note);
        return id === 'r1' ? profileView(note) : cardView(id, note);
      };
      if (!next.some((r) => r.active)) return back('⚠️ Нужно хотя бы одно включённое резюме — иначе искать нечего');
      apply({ resumes: next });
      return back(job.field === 'on' ? '▶️ Поиск включён' : '⏸ Поиск выключен');
    }
    case 'new':
      if (!nextResumeId(s)) return listView(limitNote);
      state.await = { kind: 'create', at: now };
      show(
        'rm wait',
        '➕ <b>Новое резюме</b>\nПришли PDF файлом или вставь текст ответом на вопрос ниже. У него будут свой поиск и свои правила оценки; подпись, контакт и пояс — общие. Пол, город и имя возьму из основного резюме, если в новом их нет.',
      );
      return ask('newresume');
    case 'ren':
      if (!known || id === 'r1') return listView('⚠️ Такого резюме нет');
      state.target = id;
      ask('rname');
      return cardView(id);
    case 'clone': {
      if (!known) return listView('⚠️ Такого резюме нет');
      const copyId = nextResumeId(s);
      if (!copyId) return listView(limitNote);
      apply({
        resumes: [...list, { id: copyId, name: uniqueName(clip(`${name} (копия)`, 60), list), active: false, hh: null }],
        [`resume.${copyId}`]: resumeData(rsOf(id)),
      });
      state.target = copyId;
      return cardView(copyId, '📋 Копия готова. Поиск выключен, чтобы она не искала то же, что оригинал: поправь («✏️ Поправить») и включи.');
    }
    case 'del': {
      if (!known || id === 'r1') return listView('⚠️ Основное резюме удалить нельзя');
      if (arg !== 'y') {
        state.target = id;
        return deleteView(id);
      }
      let next = list.filter((r) => r.id !== id);
      // Нужно хотя бы одно включённое: иначе сбор нечего искать
      if (!next.some((r) => r.active)) next = next.map((r) => (r.id === 'r1' ? { ...r, active: true } : r));
      apply({ resumes: next, [`resume.${id}`]: null });
      delete state.target;
      return listView(`🗑 Удалил «${esc(name)}».`);
    }
    case 'txt':
      if (!known || id === 'r1') return listView('⚠️ Такого резюме нет');
      state.target = id;
      state.await = { kind: 'replace', id, at: now };
      return show('rm wait', `📄 <b>Новый текст для «${esc(name)}»</b>\nПришли PDF файлом. Потом спрошу: заново собрать поиск и правила или заменить только текст.`);
    default:
      return listView();
  }
}

if (plan.problem) {
  plain(`⚠️ ${esc(plan.problem)}`, true);
} else if (job.op === 'not_pdf') {
  plain('📎 Это не PDF. Пришли резюме в PDF: на hh — «Мои резюме» → резюме → «Скачать» → PDF.', true);
} else if (pdf?.problem) {
  plain(`⚠️ ${esc(pdf.problem)}`);
} else if (pdf?.replace) {
  state.panelId = panelId;
  const file = state.pending?.fileName ? ` «${esc(state.pending.fileName)}»` : '';
  const forResume = state.pending?.target ? resumeById(s, state.pending.target) : null;
  const asNew = '➕ <b>Как новое резюме</b> — отдельное резюме со своим поиском и правилами.';
  if (forResume) {
    show(
      'pf replace',
      [
        `📄 Новый текст${file} для резюме «${esc(forResume.name)}».`,
        '🔄 <b>Всё заново</b> — разберу его и пересоберу поиск и правила этого резюме; подпись, контакт, пояс, письма и чёрный список останутся.',
        '📄 <b>Только текст</b> — заменю текст резюме, остальное не трогаю.',
        asNew,
      ].join('\n'),
    );
  } else if (frontend) {
    show('pf replace text', `📄 Новое резюме${file}.\nУ тебя пресет «Фронтенд»: поиск и правила настроены вручную — обновлю только текст резюме.\n${asNew}`);
  } else {
    show(
      'pf replace',
      [
        `📄 Новое резюме${file}.`,
        '🔄 <b>Всё заново</b> — разберу его и пересоберу поиск и правила; подпись, контакт, пояс, письма и чёрный список останутся.',
        '📄 <b>Только текст</b> — заменю текст резюме, остальное не трогаю.',
        asNew,
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
    // Новое резюме (create): «➕ Новое резюме», «➕ Как новое резюме» и правка такого черновика до сохранения
    const creating = Boolean(plan.create || pdf?.create);
    state.mode = creating ? 'create' : extractMode === 'revise' ? 'revise' : 'replace';
    state.step = 'review';
    reviewView(
      creating
        ? extractMode === 'revise'
          ? '✏️ <b>Поправил новое резюме</b>. Сохраню отдельным резюме: у него свой поиск и правила.'
          : '🆕 <b>Новое резюме разобрано.</b> Сохраню отдельным резюме: у него свой поиск и правила оценки. Подпись, контакт, пояс и чёрный список — общие.'
        : extractMode === 'revise'
          ? '✏️ <b>Поправил профиль</b>. Подпись, контакт, пояс и письма — без изменений.'
          : '📄 <b>Новое резюме разобрано.</b> Подпись, контакт, пояс, письма и чёрный список останутся прежними.',
    );
  }
} else if (job.op === 'rm') {
  if (ready) rmOp();
  else plain('📄 Несколько резюме — после основного: сначала пришли резюме в PDF.');
} else if (job.op === 'view') {
  profileView();
} else if (job.op === 'ok') {
  // В кнопке — шаг, на котором её показали: двойное нажатие или старая панель не перескочат шаг
  if (onboarding && (!job.value || job.value === state.step)) nextStep();
  else if (onboarding) showStep();
  else home();
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
    else home(`⚠️ Не понял часовой пояс «${esc(clip(text, 40))}». Пришли город или смещение вида UTC+2.`);
  } else if (job.field === 'extra') setField('extra', text === '-' ? '' : text.slice(0, 4000));
  else if (job.field === 'examples') setField('examples', text === '-' ? '' : text.slice(0, 4000));
  else if (job.field === 'rname') {
    const id = targetNow();
    const list = resumeList(s);
    const name = clip(text, 60);
    if (!id) home('⚠️ Не понял, какое резюме переименовать');
    else if (!name) cardView(id, '⚠️ Название пустое — прежнее осталось');
    else {
      apply({ resumes: list.map((r) => (r.id === id ? { ...r, name: uniqueName(name, list.filter((x) => x.id !== id)) } : r)) });
      cardView(id, '✅ Переименовал. У вакансий, найденных раньше, в карточке остаётся прежнее название.');
    }
  }
} else if (job.op === 'replace') {
  if (job.value === 'text' && state.pending?.text) {
    // Новый текст: основного резюме — profile.resume, другого — resume.<id>.resume
    const id = state.pending.target;
    apply(id ? resumeRows(s, id, { resume: state.pending.text }) : { 'profile.resume': state.pending.text });
    clear();
    if (id) state.target = id;
    home('✅ Текст резюме обновлён');
  } else {
    clear();
    home(job.value === 'no' ? 'Новое резюме не сохранил.' : '');
  }
} else if (job.op === 'confirm') {
  const editId = (state.mode === 'replace' ? state.pending?.target : targetNow()) || '';
  if (job.value === 'yes' && state.draft && ['replace', 'revise', 'create'].includes(state.mode)) {
    if (state.mode === 'create') saveNewResume();
    else if (editId) saveResumeEdit(editId);
    else {
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
    }
  } else {
    const wasCreate = state.mode === 'create';
    clear();
    if (wasCreate) listView('Отменил — новое резюме не создано.');
    else home('Отменил — профиль прежний.');
  }
} else {
  home();
}

return [{ json: out }];
