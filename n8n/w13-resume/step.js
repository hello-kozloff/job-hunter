// W13 · Step — ответ нейросети в сессию, экран панели, сохранение (15.10.2026, docs/recommendations.md).
// Нода: Code, режим «Run Once for All Items».
// Вход: «Job», «Plan» (что уже сделала кнопка человека), «Settings», static data (сессия), а если выполнялись —
//       «Parse» (ответ нейросети), «Hh» (ответ робота: резюме hh) и «Vacancies» (строки вакансий: покрытие навыков).
// Выход: { save: { имя: значение } | null, view: { layout, text, b, messageId } | null, freeze: { messageId, text } | null,
//          prompt: текст | null, deleteIds: [] }
//   save — строки settings (upsert): profile.resume, profile.extra, resume.history, cv (разделы резюме);
//   view — панель: messageId — правим это сообщение, 0 — новое (вопросы и правки идут новой панелью под планом);
//   freeze — план остаётся в чате без кнопок (урок 14.10.2026: затёртую сводку онбординга не видели);
//   prompt — вопрос ForceReply (ответ придёт в W13 как op input);
//   photos — снимки робота [{ shot, caption }] (сухой прогон выгрузки на hh): «Photos» → «Get shot» → «Send shot».

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

// @include n8n/shared/resumes.js

// @include n8n/shared/menu.js

// @include n8n/shared/skills.js

// @include n8n/shared/resume.js

// @include n8n/shared/cv.js

const job = $('Job').first().json;
const plan = $('Plan').first().json;
const all = loadSettings($('Settings').all());
const state = $getWorkflowStaticData('global');
// С каким резюме работаем (Plan уже вернул удалённое к основному); s — настройки этого резюме
const scope = resumeScope(all, state.target);
const s = scope.s;
const ran = (name) => {
  try {
    return $(name).first().json;
  } catch {
    return null; // нода в этом запуске не выполнялась
  }
};
// Вакансии этого резюме (у одного резюме — все): по ним покрытие навыков
const rows = (() => {
  try {
    return resumeVacancies(
      all,
      $('Vacancies')
        .all()
        .map((i) => i.json)
        .filter((r) => r?.id),
      scope.id,
    );
  } catch {
    return null;
  }
})();

const out = { save: null, view: null, freeze: null, prompt: null, deleteIds: [], photos: [] };
const panelId = job.messageId || state.panelId || 0;
if (job.op === 'input') out.deleteIds = [job.userMessageId, job.promptId].filter(Boolean);
const show = (layout, text, b = {}, messageId = panelId) => {
  out.view = { layout, text, b, messageId };
};
const BACK_RECS = { text: '⬅️ Рекомендации', cb: 'rs:view' };
const BY = { upgrade: 'Upgrade', analyze: 'анализ', undo: 'откат', split: 'разделы', skills: 'навыки hh', export: 'с hh' };
const when = (iso) => (Date.parse(iso) ? `${localDM(Date.parse(iso))} ${localHM(Date.parse(iso))}` : '');
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

function ask(field, help) {
  out.prompt = `${RESUME_PROMPTS[field]}\n${help}\nОтветь на это сообщение.`;
}

// ---------- Экраны ----------

// Разделы резюме на панели (часть D): что разложено, или подсказка разложить
function sectionsLines() {
  if (!s.cv) return ['🧩 Разделы: ещё не разложено. 💼 и 🧰 разложат резюме и сверят его с hh.'];
  if (!cvFresh(s)) return ['📝 Резюме поменялось после разметки: 💼 и 🧰 разложат его заново.'];
  const r = s.cv.resumes[0];
  const n = s.cv.places.length;
  return [
    `📄 «${esc(oneLine(r.title || 'без должности', 80))}»${scope.link || r.hh ? ' · связано с резюме на hh' : ''}`,
    `💼 Опыт работы, общий для всех резюме: ${n} ${plural(n, 'место', 'места', 'мест')}`,
    `🧰 Ключевые навыки для hh: ${r.keySkills.length} из ${KEY_SKILLS_MAX}`,
  ];
}

// Робот не прочитал резюме hh: почему и что делать
const HH_ERRORS = {
  busy: 'робот сейчас откликается на вакансию — повтори через минуту',
  captcha: 'hh показал капчу: пройди её в окне робота («Общий экран»), потом повтори',
  login: 'робот не вошёл в hh: войди в окне робота, потом повтори',
  layout: 'страница резюме на hh не разобралась (поменялась вёрстка?)',
  no_resume: 'на hh нет ни одного резюме',
  not_found: 'резюме, связанного с ботом, на hh больше нет',
  down: 'робот не отвечает',
};
const hhWhy = (error) =>
  HH_ERRORS[error] ?? (String(error).startsWith('blocked') ? `робот на паузе (${String(error).slice(8) || 'блок'}): сними блок в ⚙️ → 🚀 Робот` : `ошибка робота (${error})`);
function hhErrorView(error, messageId = panelId) {
  const sess = state.session;
  const why = hhWhy(error);
  show(
    'rc retry',
    ['🧩 <b>Разделы резюме</b>', `⚠️ Резюме на hh не прочитал: ${esc(why)}.`, 'Можно повторить или разложить только резюме бота: сверка с hh будет при выгрузке.'].join('\n'),
    { retry: `rc:${sess.sid}:hh`, nohh: `rc:${sess.sid}:nohh`, x: `rc:${sess.sid}:x` },
    messageId,
  );
}

// Разделы, которые на hh не такие, как в боте: должность, «О себе», должность и описание общих мест; места только на hh
function splitFields(cv, hh) {
  if (!hh) return [];
  const r = cv.resumes[0];
  const fields = [];
  if (hh.title && !cvSame(r.title, hh.title)) fields.push({ kind: 'title', key: 'title', bot: r.title, hh: hh.title });
  if (hh.about && !cvSame(r.about, hh.about)) fields.push({ kind: 'about', key: 'about', bot: r.about, hh: hh.about });
  const { pairs, onlyHh } = cvMatchPlaces(cv, hh.places);
  for (const { place, hh: h } of pairs) {
    place.hhId = h.hhId;
    if (!cvSame(place.position, h.position)) fields.push({ kind: 'position', key: `p:${place.id}`, company: place.company, bot: place.position, hh: h.position });
    if (!cvSame(place.description, h.description)) fields.push({ kind: 'description', key: `d:${place.id}`, company: place.company, bot: place.description, hh: h.description });
  }
  for (const h of onlyHh) fields.push({ kind: 'place', company: h.company, hh: h });
  return fields.slice(0, 40);
}
const fieldName = (f) =>
  ({ title: 'должность', about: '«О себе»', position: `${f.company} — должность`, description: `${f.company} — описание`, place: f.company })[f.kind];

function fieldView(messageId = panelId) {
  const sess = state.session;
  const f = sess.fields[sess.fi];
  const cb = (v) => `rc:${sess.sid}:${sess.fi}:${v}`;
  const head = `🧩 <b>Разделы резюме</b> · ${sess.fi + 1} из ${sess.fields.length}`;
  const sharedText = scope.several
    ? '⚠️ Опыт работы на hh общий для всех резюме. В боте это место поменяется только в этом резюме.'
    : '⚠️ Опыт работы общий для всех резюме: и в боте, и на hh (во всех резюме, где отмечено это место).';
  const shared = !['title', 'about'].includes(f.kind) ? sharedText : null;
  if (f.kind === 'place') {
    const lines = [
      head,
      `💼 <b>${esc(f.hh.company)}</b> — ${esc(f.hh.position)}${cvPeriod(f.hh.start, f.hh.end) ? ` (${cvPeriod(f.hh.start, f.hh.end)})` : ''}`,
      'Это место есть на hh, но в резюме бота его нет.',
      shared,
      f.hh.description ? `<i>${esc(oneLine(f.hh.description, 600))}</i>` : null,
    ];
    return show('rc place', lines.filter(Boolean).join('\n'), { add: cb('a'), skip: cb('k'), x: `rc:${sess.sid}:x` }, messageId);
  }
  const name = { title: '📄 Должность', about: '📄 «О себе»', position: `💼 ${esc(f.company)} — должность`, description: `💼 ${esc(f.company)} — описание` }[f.kind];
  const lines = [
    head,
    `<b>${name}</b>`,
    shared,
    f.bot ? 'На hh по-другому. <s>Зачёркнуто</s> — только в боте, <b>жирным</b> — только на hh:' : 'В резюме бота этого нет, на hh есть:',
    f.bot ? wordDiff(f.bot, f.hh, 6, 2500) : esc(oneLine(f.hh, 1500)),
  ];
  show('rc field', lines.filter(Boolean).join('\n'), { bot: cb('b'), hh: cb('h'), x: `rc:${sess.sid}:x` }, messageId);
}

// Ключевые навыки hh: что сейчас на hh (или выбрано раньше) + навыки из резюме, которые есть в вакансиях; частота —
// в скольких подходящих вакансиях. Выбранные не теряются, остальные — до 48 (6 страниц по 8)
function skillsInit(cv, hh) {
  const text = resumeJoin({ resume: cvRender(cv), extra: state.session.draft.extra });
  const st = rows ? skillStats(rows, text, 60) : null;
  const freq = new Map((st?.top ?? []).map((x) => [skillKey(x.name), x.freq]));
  const base = hh?.keySkills?.length ? hh.keySkills : cv.resumes[0].keySkills;
  const items = new Map();
  for (const name of base) if (!items.has(skillKey(name))) items.set(skillKey(name), { name, freq: freq.get(skillKey(name)) ?? 0, on: true });
  for (const x of st?.top ?? []) if (x.has && !items.has(skillKey(x.name))) items.set(skillKey(x.name), { name: x.name, freq: x.freq, on: false });
  const byFreq = (a, b) => b.freq - a.freq || a.name.localeCompare(b.name);
  const all = [...items.values()].sort(byFreq);
  const on = all.filter((x) => x.on).slice(0, KEY_SKILLS_MAX);
  const list = [...on, ...all.filter((x) => !x.on).slice(0, Math.max(0, 48 - on.length))].sort(byFreq);
  // Без hh и без прошлого выбора — сначала отмечены самые частые
  const picked = base.length ? on.map((x) => x.name) : list.slice(0, KEY_SKILLS_MAX).map((x) => x.name);
  return { list: list.map(({ name, freq: n }) => ({ name, freq: n })), picked, page: 0, note: '', fromHh: Boolean(hh?.keySkills?.length) };
}
function skillsView(messageId = panelId) {
  const sess = state.session;
  const k = sess.skills;
  const pages = Math.max(1, Math.ceil(k.list.length / 8));
  k.page = Math.min(Math.max(0, k.page), pages - 1);
  const cb = (v) => `rk:${sess.sid}:${v}`;
  const none = { text: '·', cb: 'p:x' };
  const b = {};
  for (let j = 0; j < 8; j++) {
    const i = k.page * 8 + j;
    const x = k.list[i];
    b[`o${j}`] = x ? { text: `${k.picked.includes(x.name) ? '✅' : '◻️'} ${oneLine(x.name, 26)}${x.freq ? ` · ${x.freq}` : ''}`, cb: cb(i) } : none;
  }
  b.prev = k.page > 0 ? { text: '◀️', cb: cb(`p${k.page - 1}`) } : none;
  b.next = k.page < pages - 1 ? { text: '▶️', cb: cb(`p${k.page + 1}`) } : none;
  b.done = { text: `✅ Готово · ${k.picked.length}/${KEY_SKILLS_MAX}`, cb: cb('d') };
  b.x = cb('x');
  const lines = [
    '🧰 <b>Ключевые навыки для hh</b>',
    `Выбрано <b>${k.picked.length}</b> из ${KEY_SKILLS_MAX}. hh показывает их работодателям отдельным списком, ATS ищет по ним.`,
    `Рядом с навыком — в скольких твоих вакансиях он есть. ${k.fromHh ? 'Отмечены те, что сейчас на hh.' : 'Отмечены самые частые в твоих вакансиях.'}`,
    'В текст резюме бота они не попадают: это список для hh.',
    pages > 1 ? `Страница ${k.page + 1} из ${pages}.` : null,
    k.note ? `\n⚠️ ${k.note}` : null,
  ];
  show('rk skills8', lines.filter(Boolean).join('\n'), b, messageId);
}

// 💼 Опыт работы: места (общие для всех резюме) и «Улучшить опыт»
function expView(note = '', messageId = panelId) {
  const places = s.cv.places;
  const lines = [
    scope.several ? '💼 <b>Опыт работы</b> — на hh общий для всех резюме' : '💼 <b>Опыт работы</b> — общий для всех резюме',
    scope.several
      ? '⚠️ Правка опыта в боте меняет только это резюме, а на hh — при выгрузке, и там — во всех резюме, где отмечено место.'
      : '⚠️ Правка опыта меняет его во всех резюме: в боте сразу, на hh — при выгрузке (во всех резюме, где отмечено место).',
    '',
    ...places.map(
      (p, i) =>
        `${i + 1}. <b>${esc(p.company || 'Место работы')}</b> — ${esc(oneLine(p.position, 80))}${p.period ? ` · ${esc(p.period)}` : ''} · ${num(p.description.length)} знаков${p.hhId ? ' · 🔗 hh' : ''}`,
    ),
    places.length ? null : 'Мест работы в резюме не нашёл.',
    '',
    '⬆️ <b>Улучшить опыт</b> — напиши, что добавить или поменять: правки будут только в опыте работы.',
    note ? `\n${note}` : null,
  ];
  show('rx exp', lines.filter((l) => l !== null).join('\n'), {}, messageId);
}

// ---------- Выгрузка на hh (часть D, E2/E3) ----------

const itemName = (x) =>
  ({ title: 'должность', about: '«О себе»', skills: 'ключевые навыки' })[x.key] ?? `${x.company} (опыт)`;
function resultName(r) {
  if (r.kind !== 'place') return { title: 'Должность', about: '«О себе»', skills: 'Ключевые навыки' }[r.kind] ?? r.kind;
  const x = state.session?.items.find((i) => i.key === 'place' && i.hhId === r.hhId);
  return `💼 ${x?.company || 'Место работы'}`;
}

// После чтения hh: разделы, которые на hh другие; нет — «уже как в боте»
function exportAfterRead(messageId) {
  const sess = state.session;
  if (sess.hhError || !sess.hh) {
    state.session = null;
    return show('rs retry', `📤 <b>Обновить на hh</b>\n⚠️ Резюме на hh не прочитал: ${esc(hhWhy(sess.hhError || 'down'))}.`, { retry: 're:go' }, messageId);
  }
  sess.items = cvExportItems(sess.cv, sess.hh);
  sess.ii = 0;
  if (!sess.items.length) {
    state.session = null;
    return show('rs back', '📤 ✅ На hh уже как в боте: должность, «О себе», ключевые навыки и опыт совпадают.', { back: BACK_RECS }, messageId);
  }
  itemView(messageId);
}

function itemView(messageId = panelId) {
  const sess = state.session;
  const x = sess.items[sess.ii];
  const cb = (v) => `re:${sess.sid}:${sess.ii}:${v}`;
  const legend = '<s>Зачёркнуто</s> — сейчас на hh, уйдёт; <b>жирным</b> — из бота, появится на hh.';
  let body;
  if (x.key === 'skills') {
    const d = cvSkillsDiff(x.hh, x.bot);
    body = [
      '🧰 <b>Ключевые навыки</b>',
      d.add.length ? `➕ Добавлю: ${esc(d.add.join(', '))}` : null,
      d.remove.length ? `➖ Уберу: ${esc(d.remove.join(', '))}` : null,
    ];
  } else if (x.key === 'place') {
    body = [
      `💼 <b>${esc(x.company)}</b>`,
      '⚠️ Опыт работы общий: на hh поменяется во всех резюме, где отмечено это место.',
      legend,
      x.botPosition !== undefined ? `<i>Должность:</i> ${wordDiff(x.hhPosition, x.botPosition)}` : null,
      x.botDescription !== undefined ? `<i>Описание:</i> ${wordDiff(x.hhDescription, x.botDescription, 6, 2200)}` : null,
    ];
  } else {
    body = [`<b>${x.key === 'title' ? '📄 Должность' : '📄 «О себе»'}</b>`, x.warn ? `⚠️ ${x.warn} — пропущу.` : null, legend, wordDiff(x.hh, x.bot, 6, 2500)];
  }
  const lines = [`📤 <b>Обновить на hh</b> · ${sess.ii + 1} из ${sess.items.length}`, ...body];
  show('re item', lines.filter(Boolean).join('\n'), { push: cb('p'), skip: cb('k'), take: cb('h'), x: `re:${sess.sid}:x` }, messageId);
}

// «⬅️ Взять с hh в бота» — сохраняется сразу после выбора по разделам: выгрузка на hh от этого не зависит
function saveBotChanges() {
  const sess = state.session;
  if (sess.botSaved) return sess.botNote ?? '';
  sess.botSaved = true;
  const took = sess.items.filter((x) => x.choice === 'h');
  if (!took.length) return '';
  const text = cvRender(sess.cv);
  if (resumeHash(resumeDraft(s)) !== sess.base) sess.botNote = '⚠️ Пока сравнивал, резюме бота поменялось — взятое с hh не сохранил.';
  else if (text.length > SETTINGS['profile.resume'].text) sess.botNote = '⚠️ Резюме бота вышло бы длиннее 30 000 знаков — взятое с hh не сохранил.';
  else {
    out.save = { cv: sess.cv, 'resume.history': [version('export', 'взято с hh', sess.original), ...s['resume.history']].slice(0, 5) };
    if (text !== sess.original.resume) out.save['profile.resume'] = text;
    Object.assign(s, out.save);
    sess.botNote = `⬅️ В бота взял с hh: ${esc(took.map(itemName).join('; '))}.`;
  }
  return sess.botNote;
}

function summaryView(messageId = panelId) {
  const sess = state.session;
  const note = saveBotChanges();
  const push = sess.items.filter((x) => x.choice === 'p' && !x.warn);
  if (!push.length) {
    state.session = null;
    return rootView([note, '📤 На hh ничего не меняю.'].filter(Boolean).join('\n'));
  }
  const lines = [
    '📤 <b>Обновить на hh</b>',
    `На hh уйдёт: ${esc(push.map(itemName).join('; '))}.`,
    push.some((x) => x.key === 'place') ? '⚠️ Опыт работы общий: на hh поменяется во всех резюме, где отмечены эти места.' : null,
    note || null,
    '',
    // Запись включена — сразу «Записать» (сухой прогон владельцу не нужен, 15.10.2026); выключена — только сухой
    // прогон: им проверяют робота перед включением RESUME_LIVE
    sess.live
      ? '✅ <b>Записать на hh</b> — робот сохранит разделы на hh и сверит, прочитав резюме заново. Копия резюме hh до записи остаётся у робота.'
      : '🧪 <b>Сухой прогон</b> — робот заполнит формы hh, пришлёт снимки и ничего не сохранит. Записывать на hh он начнёт, когда в .env будет RESUME_LIVE=1.',
  ];
  show(sess.live ? 're sum' : 're sumdry', lines.filter((l) => l !== null).join('\n'), { dry: `re:${sess.sid}:dry`, live: `re:${sess.sid}:live`, x: `re:${sess.sid}:x` }, messageId);
}

const RESULT_TEXT = { dry: 'заполнено', saved: 'сохранено', same: 'на hh уже так' };
const resultLine = (r) =>
  r.outcome === 'error' ? `⚠️ ${esc(resultName(r))}: ${esc(r.note || 'ошибка')}` : `${r.outcome === 'same' ? '⏭' : '✅'} ${esc(resultName(r))}: ${RESULT_TEXT[r.outcome] ?? r.outcome}`;

// Сверка живой записи: что hh показывает после — то же, что отправили
function verified(r, after) {
  const x = state.session.items.find((i) => (r.kind === 'place' ? i.key === 'place' && i.hhId === r.hhId : i.key === r.kind));
  if (!after || !x) return false;
  if (r.kind === 'title' || r.kind === 'about') return cvSame(r.kind === 'title' ? after.title : after.about, x.bot);
  if (r.kind === 'skills') {
    const d = cvSkillsDiff(after.keySkills, x.bot);
    return !d.add.length && !d.remove.length;
  }
  const p = after.places.find((h) => h.hhId === r.hhId);
  return Boolean(p) && (x.botPosition === undefined || cvSame(p.position, x.botPosition)) && (x.botDescription === undefined || cvSame(p.description, x.botDescription));
}

function writeView() {
  const sess = state.session;
  const messageId = plan.wait?.messageId || panelId;
  if (sess.writeError) {
    return show(
      'rs retry',
      `📤 <b>Обновить на hh</b>\n⚠️ Робот не ${sess.dry ? 'заполнил формы' : 'записал разделы'}: ${esc(hhWhy(sess.writeError))}.`,
      { retry: `re:${sess.sid}:${sess.dry ? 'dry' : 'live'}` },
      messageId,
    );
  }
  const lines = sess.results.map(resultLine);
  if (!sess.wroteLive) {
    // Сухой прогон: снимки — новыми сообщениями, итог — новой панелью под ними (старая остаётся без кнопок)
    out.photos = sess.results
      .filter((r) => r.shot)
      .map((r) => ({ shot: r.shot, caption: `🧪 ${esc(resultName(r))}: так будет на hh (не сохранено)` }));
    out.freeze = { messageId, text: '📤 Обновить на hh: сухой прогон — снимки ниже.' };
    const text = [
      '🧪 <b>Сухой прогон</b>: робот заполнил формы hh и ничего не сохранил.',
      ...lines,
      '\nЗаписывать на hh робот начнёт, когда в .env будет RESUME_LIVE=1 (scripts/deploy.sh --applier).',
    ].join('\n');
    state.session = null;
    return show('rs back', text, { back: BACK_RECS }, 0);
  }
  // Живая запись: сверка чтением (сессия закрывается после: подписи разделов берутся из неё)
  const saved = sess.results.filter((r) => r.outcome === 'saved');
  const checks = saved.map((r) => (verified(r, sess.after) ? `✅ ${esc(resultName(r))}: на hh так` : `⚠️ ${esc(resultName(r))}: сохранено, но при чтении hh отличается`));
  state.session = null;
  const text = [
    saved.length ? '✅ <b>Резюме на hh обновлено.</b>' : '⚠️ <b>На hh ничего не сохранилось.</b>',
    ...lines,
    sess.after ? (checks.length ? `\n<i>Сверка чтением:</i>\n${checks.join('\n')}` : null) : '⚠️ Сверить не вышло: резюме hh после записи не прочитал.',
  ];
  show('rs done', text.filter(Boolean).join('\n'), {}, messageId);
}

// Конец раскладки (или выбора навыков): разметка, текст (если что-то взято с hh), версия для отката
function finishSplit() {
  const sess = state.session;
  state.session = null;
  const cv = sess.cv;
  const r = cv.resumes[0];
  if (sess.skills) r.keySkills = sess.skills.picked.slice(0, KEY_SKILLS_MAX);
  if (sess.hh) r.hh = { hash: String(sess.hh.hash).slice(0, 64), title: oneLine(sess.hh.title, 200) };
  const text = cvRender(cv);
  if (text.length > SETTINGS['profile.resume'].text) return show('rs back', '⚠️ Резюме вышло бы длиннее 30 000 знаков — не сохранил.', { back: BACK_RECS });
  if (resumeHash(resumeDraft(s)) !== sess.base) return show('rs back', '⚠️ Пока раскладывал, резюме поменялось (новый PDF?). Начни заново.', { back: BACK_RECS });
  const changed = text !== sess.original.resume;
  out.save = { cv };
  if (changed) out.save['profile.resume'] = text;
  if (changed || sess.original.cv) {
    out.save['resume.history'] = [version(sess.kind, sess.kind === 'skills' ? 'ключевые навыки hh' : 'разделы', sess.original), ...s['resume.history']].slice(0, 5);
  }
  Object.assign(s, out.save);
  const fields = sess.fields ?? [];
  const took = fields.filter((f) => f.choice === 'h').map(fieldName);
  const added = fields.filter((f) => f.choice === 'a').map((f) => f.company);
  const botOnly = sess.hh ? cv.places.filter((p) => !p.hhId).map((p) => p.company || 'без названия') : [];
  const lines =
    sess.kind === 'skills'
      ? [`✅ Ключевые навыки для hh: ${r.keySkills.length} из ${KEY_SKILLS_MAX}.`]
      : [
          '✅ <b>Разделы готовы.</b>',
          took.length ? `🌐 С hh взял: ${esc(took.join('; '))}.` : sess.hh ? '🤖 Всё оставил как в боте.' : null,
          added.length ? `➕ Добавил места с hh: ${esc(added.join(', '))}.` : null,
          botOnly.length ? `💼 Только в боте, на hh нет: ${esc(botOnly.join(', '))}.` : null,
          sess.problems?.length ? `⚠️ Не разложил, осталось текстом: ${esc(sess.problems.join('; '))}.` : null,
          sess.hh ? null : `🤖 Резюме hh не читал${sess.hhError ? ` (${esc(HH_ERRORS[sess.hhError] ?? sess.hhError)})` : ''}: сверка с hh будет при выгрузке.`,
          changed ? 'Новое резюме уже работает в оценке вакансий и в письмах.' : null,
        ];
  const note = lines.filter(Boolean).join('\n');
  if (sess.back === 'exp' && cv.places.length) return expView(note);
  rootView(note);
}


function coverageLine(st) {
  if (!st || st.coverage === null) return '🎯 Покрытие навыков появится, когда наберутся вакансии с ключевыми навыками.';
  const basis =
    st.basis === 'target' ? `по ${st.vacancies} вакансиям, которые тебе подходят` : `по ${st.vacancies} вакансиям из поиска (твоих решений пока мало)`;
  return `🎯 Навыки твоих вакансий в резюме: <b>${percent(st.coverage)}</b> — ${basis}`;
}

// Выбор резюме для рекомендаций (резюме больше одного): 👉 — с каким работаем сейчас
function pickView() {
  const list = resumeList(all).filter((r) => r.id === 'r1' || all[`resume.${r.id}`]);
  if (list.length < 2) return rootView();
  const b = {};
  list.forEach((r, i) => {
    b[`r${i}`] = { text: `${r.id === scope.id ? '👉 ' : ''}${oneLine(r.name, 28)}${r.hh ? ' 🔗' : ''}`, cb: `rs:r:${r.id}` };
  });
  const lines = [
    '💡 <b>Рекомендации</b>: какое резюме правим?',
    '',
    ...list.map((r) => `${r.id === scope.id ? '👉' : '📄'} <b>${esc(r.name)}</b>${r.hh ? ' · 🔗 связано с hh' : ' · не связано с hh'}${r.active ? '' : ' · ⏸ поиск выключен'}`),
    '',
    'У каждого резюме свои правки, вакансии (для покрытия навыков) и откат. Разделы и выгрузка на hh — у резюме, связанных с hh.',
  ];
  show(`rs pick${list.length}`, lines.join('\n'), b);
}

function rootView(note = '') {
  const d = resumeDraft(s);
  if (!s['profile.ready'] || !d.resume) {
    return show(
      'rs back',
      scope.id === 'r1'
        ? '📄 Сначала пришли резюме PDF — без него рекомендовать нечего.'
        : '📄 В этом резюме пока нет текста: ⚙️ → 📄 Резюме → открой его → «📄 Новый текст».',
      { back: scope.id === 'r1' ? { text: '⬅️ Настройки', cb: 's:root' } : { text: '⬅️ Резюме', cb: 'rm:list' } },
    );
  }
  const h = s['resume.history'][0];
  const st = rows ? skillStats(rows, resumeJoin(d)) : null;
  // Разделы, ключевые навыки и выгрузка — только с резюме на hh: основное связывается само (💼), у r2–r5 связь — от импорта
  const hhOk = scope.id === 'r1' || Boolean(scope.link);
  const lines = [
    '💡 <b>Рекомендации по резюме</b>',
    scope.several ? `📚 Резюме: <b>${esc(scope.name)}</b>${scope.link ? ' · 🔗 связано с hh' : ' · не связано с hh'}` : null,
    '',
    `📄 Резюме: ${num(resumeJoin(d).length)} знаков${h ? ` · последняя правка ${when(h.at)} (${BY[h.by] ?? h.by})` : ''}`,
    coverageLine(st),
    st?.missing.length ? `    нет в резюме: ${esc(st.missing.slice(0, 5).map((x) => x.name).join(' · '))}` : null,
    ...(hhOk
      ? sectionsLines()
      : ['🔗 Не связано с hh: разделы, ключевые навыки и выгрузка на hh появятся после импорта (⚙️ → 📄 Резюме → 📥 Импорт с hh).']),
    '',
    '🔍 <b>Анализ</b> — посмотрю резюме глазами ATS и роботов hh, задам до 8 вопросов кнопками и предложу правки.',
    '⬆️ <b>Upgrade</b> — напиши, что добавить или поменять: покажу, куда впишу, и спрошу про каждую правку.',
    hhOk ? '💼 <b>Опыт работы</b> — места работы, общие для всех резюме. 🧰 <b>Навыки hh</b> — выбрать 30 ключевых навыков.' : null,
    hhOk ? '📤 <b>Обновить на hh</b> — сравню резюме бота с hh, покажу разницу по разделам и выгружу роботом.' : null,
    '📄 <b>Файлом</b> — резюме бота целиком. ↩️ <b>Откатить</b> — вернуть версию до последней правки.',
    scope.several ? '📄 <b>Другое резюме</b> — переключиться на другое резюме.' : null,
    note ? `\n${note}` : null,
  ];
  show(!scope.several ? 'rs root' : hhOk ? 'rs rootm' : 'rs rootm0', lines.filter((l) => l !== null).join('\n'));
}

function planText(sess) {
  const p = sess.plan;
  const n = sess.questions.length;
  return [
    '⬆️ <b>Upgrade резюме</b>',
    `Просьба: «${esc(oneLine(sess.instruction, 300))}»`,
    '',
    p.understood ? `Понял так: ${esc(p.understood)}` : null,
    p.places.length ? '<b>Куда впишу</b>' : '<b>Куда впишу</b> — решу после ответа на вопрос.',
    ...p.places.map((x, i) => `${i + 1}. ${esc(x.where)} — ${x.action === 'replace' ? '✏️' : '➕'} ${esc(x.what)}`),
    p.places.some((x) => x.action === 'replace') ? '<i>✏️ — старый текст придётся убрать или переписать, ➕ — только допишу.</i>' : null,
    n ? `\nПотом уточню: ${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}.` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');
}
function planView(note = '', messageId = panelId) {
  const sess = state.session;
  sess.planText = planText(sess);
  sess.planMsg = messageId;
  const cb = (v) => `ru:${sess.sid}:${v}`;
  show('ru plan', `${sess.planText}\n\n${note ? `${note}\n` : ''}Верно понял?`, { yes: cb('y'), edit: cb('e'), no: cb('n') }, messageId);
}

// Отчёт анализа: главное и сколько вопросов. После «▶️ Начать» остаётся в чате, вопросы — новой панелью
function reportView(messageId = panelId) {
  const sess = state.session;
  const n = sess.questions.length;
  sess.planText = ['🔍 <b>Резюме глазами ATS и роботов hh</b>', coverageLine(sess.report.stats), '', ...sess.report.summary.map((x) => `• ${esc(x)}`)].join('\n');
  sess.planMsg = messageId;
  if (!n) {
    state.session = null;
    return show('rs back', `${sess.planText}\n\nВопросов к тебе нет: по этим правилам резюме в порядке.`, { back: BACK_RECS }, messageId);
  }
  show(
    'rs report',
    `${sess.planText}\n\nЗадам ${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}: по ответам предложу правки, каждую покажу отдельно. «⏹ Хватит» — в любой момент.`,
    { go: `rq:${sess.sid}:go`, no: `rq:${sess.sid}:x` },
    messageId,
  );
}

function questionView(messageId = panelId, note = '') {
  const sess = state.session;
  const q = sess.questions[sess.qi];
  const many = q.kind === 'many';
  const cb = (v) => `rq:${sess.sid}:${sess.qi}:${v}`;
  const b = { t: cb('t'), k: cb('k'), d: cb('d'), x: `rq:${sess.sid}:x` };
  for (let i = 0; i < (many ? 8 : q.options.length); i++) {
    const label = q.options[i];
    b[`o${i}`] =
      label === undefined ? { text: '·', cb: 'p:x' } : { text: many ? `${sess.picks.includes(i) ? '✅' : '◻️'} ${label}` : label, cb: cb(i) };
  }
  const lines = [
    `❓ <b>Вопрос ${sess.qi + 1}/${sess.questions.length}</b>${q.hint ? ' · 💡 подсказка' : ''}`,
    esc(q.text),
    many ? '\nОтметь всё, что подходит, и нажми «✅ Готово».' : null,
    note ? `\n${note}` : null,
  ];
  const layout = many ? 'rq many8' : q.kind === 'text' ? 'rq text' : `rq one${q.options.length}`;
  show(layout, lines.filter((l) => l !== null).join('\n'), b, messageId);
}

function patchView(messageId = panelId, note = '') {
  const sess = state.session;
  const p = sess.patches[sess.pi];
  const cb = (v) => `rp:${sess.sid}:${sess.pi}:${v}`;
  const lost = sess.pi === 0 ? sess.dropped.length : 0;
  const section = cvSectionName(sess.draft.cv, p.section);
  const lines = [
    `✏️ <b>Правка ${sess.pi + 1}/${sess.patches.length}</b> · ${esc(section || p.where)}`,
    cvShared(p.section)
      ? scope.several
        ? '⚠️ Опыт работы на hh общий для всех резюме: в боте правка поменяет только это резюме, на hh — все резюме, где отмечено место (при выгрузке).'
        : '⚠️ Опыт работы — общий раздел: правка поменяет его во всех резюме (на hh — при выгрузке).'
      : null,
    wordDiff(p.old, p.new),
    p.why ? `<i>Почему:</i> ${esc(p.why)}` : null,
    p.kind === 'replace'
      ? `\n⚠️ ${p.warn ? 'Дописать, ничего не убирая, не вышло: правка всё равно убирает старый текст.' : 'Правка убирает старый текст.'} Заменить?`
      : null,
    note ? `\n${note}` : null,
    lost ? `\n<i>Ещё ${lost} ${plural(lost, 'правку', 'правки', 'правок')} не смог привязать к тексту резюме — пропустил.</i>` : null,
  ];
  const b = { y: cb('y'), r: cb('r'), a: cb('a'), e: cb('e'), n: cb('n') };
  show(p.kind === 'replace' ? 'rp replace' : 'rp add', lines.filter((l) => l !== null).join('\n'), b, messageId);
}

// Вопросы и правки идут новой панелью под планом: план остаётся в чате без кнопок
function moveOn(mark = '✅ Верно') {
  const sess = state.session;
  if (sess.moved) return panelId;
  sess.moved = true;
  if (sess.planMsg && sess.planText) out.freeze = { messageId: sess.planMsg, text: `${sess.planText}\n\n${mark}` };
  return 0;
}

// Итог сессии: сохранить черновик (если резюме не поменялось за это время), версию — в историю для отката
// Подсказки анализа про фильтры hh, на которые человек ответил «поменяю» или своими словами
function tipsText(sess) {
  const tips = sess.questions
    .map((q, i) => ({ q, a: sess.answers[i] }))
    .filter(({ q, a }) => q.hint && a && !a.skipped && (a.text || a.picked?.[0] === q.options[0]));
  if (!tips.length) return null;
  return [
    '\n📝 <b>На hh поменяй сам</b> (<a href="https://hh.ru/applicant/resumes">Мои резюме</a>), эти поля бот не трогает:',
    ...tips.map(({ q, a }) => `• ${esc(q.tip)}${a.text ? ` (ты: «${esc(oneLine(a.text, 120))}»)` : ''}`),
  ].join('\n');
}

function finish() {
  const sess = state.session;
  state.session = null;
  const failed = sess.patches.filter((p) => p.state === 'fail');
  const failNote = failed.length
    ? `⚠️ Не применил: ${esc(failed.map((p) => `${p.where} (${p.note})`).join('; '))}`
    : null;
  const tips = tipsText(sess);
  const changed = sess.draft.resume !== sess.original.resume || sess.draft.extra !== sess.original.extra;
  if (!changed) {
    const head = sess.patches.length || sess.kind === 'upgrade' ? 'Ничего не поменял — резюме прежнее.' : 'Правок в резюме бота нет.';
    return show('rs back', [head, failNote, tips].filter(Boolean).join('\n'), { back: BACK_RECS });
  }
  if (resumeHash(resumeDraft(s)) !== sess.base) {
    return show('rs back', '⚠️ Пока шла правка, резюме поменялось (новый PDF?). Правки не сохранил — начни заново.', { back: BACK_RECS });
  }
  const note = sess.kind === 'upgrade' ? `«${oneLine(sess.instruction, 80)}»` : 'анализ';
  out.save = {
    'resume.history': [version(sess.kind, note, sess.original), ...s['resume.history']].slice(0, 5),
  };
  if (sess.draft.resume !== sess.original.resume) out.save['profile.resume'] = sess.draft.resume;
  if (sess.draft.extra !== sess.original.extra) out.save['profile.extra'] = sess.draft.extra;
  // Разметка правится вместе с текстом (n8n/shared/cv.js): рендер новой разметки и есть новый profile.resume
  if (sess.draft.cv && JSON.stringify(sess.draft.cv) !== JSON.stringify(sess.original.cv)) out.save.cv = sess.draft.cv;
  const before = rows ? skillStats(rows, resumeJoin(sess.original)) : null;
  const after = rows ? skillStats(rows, resumeJoin(sess.draft)) : null;
  const n = sess.patches.length;
  const lines = [
    `✅ <b>Резюме обновлено</b>: ${sess.applied} из ${n} ${plural(n, 'правки', 'правок', 'правок')}.`,
    before?.coverage != null ? `🎯 Навыки твоих вакансий в резюме: ${percent(before.coverage)} → <b>${percent(after.coverage)}</b>` : null,
    'Новое резюме уже работает в оценке вакансий и в письмах.',
    scope.link ? '🌐 На hh резюме пока прежнее: 📤 <b>Обновить на hh</b> покажет разницу и выгрузит.' : null,
    failNote,
    tips,
  ];
  show('rs done', lines.filter(Boolean).join('\n'));
}

function undoView() {
  const h = s['resume.history'][0];
  if (!h) return rootView('↩️ Откатывать нечего: через бота резюме ещё не правили.');
  show(
    'rs undo',
    `↩️ Вернуть резюме, каким оно было до правки ${when(h.at)} (${BY[h.by] ?? h.by}${h.note ? `: ${esc(h.note)}` : ''})?\nТекущая версия сохранится — передумаешь, откатишь обратно.`,
  );
}
// Версия для resume.history: текст, «Дополнительно» и разметка (если была живой)
function version(by, note, d) {
  return { at: new Date().toISOString(), by, note, resume: d.resume, extra: d.extra, ...(d.cv && { cv: d.cv }) };
}
function undo() {
  const [h, ...rest] = s['resume.history'];
  if (!h) return rootView('↩️ Откатывать нечего.');
  const cur = resumeDraft(s);
  // Версия без разметки (до неё) — разметку не трогаем: она станет неживой, а при откате обратно оживёт
  out.save = {
    'profile.resume': h.resume,
    'profile.extra': h.extra ?? '',
    ...(h.cv && { cv: h.cv }),
    'resume.history': [version('undo', `до правки ${when(h.at)}`, cur), ...rest].slice(0, 5),
  };
  Object.assign(s, out.save);
  rootView(`✅ Откатил: резюме — как до правки ${when(h.at)}.`);
}

// Что сейчас в сессии — то и показать
function current() {
  const sess = state.session;
  if (!sess) return rootView();
  if (sess.kind === 'export') {
    if (!sess.hh) return rootView();
    return sess.ii < sess.items.length ? itemView() : summaryView();
  }
  if (sess.kind === 'split' || sess.kind === 'skills') {
    if (!sess.cv) return rootView();
    if (sess.done) return finishSplit();
    if (sess.kind === 'split' && sess.fi < sess.fields.length) return fieldView();
    if (!sess.skills) sess.skills = skillsInit(sess.cv, sess.hh);
    return skillsView();
  }
  if (sess.done) return finish();
  if (sess.patches.length) return sess.pi < sess.patches.length ? patchView() : finish();
  if (sess.kind === 'analyze' && !sess.started) return sess.report ? reportView() : rootView();
  if (sess.plan && !sess.planOk) return planView();
  if (sess.qi < sess.questions.length) return questionView();
  return rootView();
}

// ---------- Что пришло ----------

const sess = state.session;
const parsed = plan.route === 'llm' || plan.route === 'robot' ? ran('Parse') : null;

if (plan.stale) {
  // Кнопка от прошлой сессии: старое сообщение — без кнопок; ответ на старый вопрос — просто удалить
  if (job.messageId) show('rs back', '⌛ Эти кнопки устарели: правка уже закончилась.', { back: BACK_RECS }, job.messageId);
} else if (plan.route === 'robot' && sess?.kind === 'export' && !sess.items.length) {
  exportAfterRead(plan.wait?.messageId || panelId);
} else if (plan.route === 'write' && sess?.kind === 'export') {
  writeView();
} else if (plan.route === 'robot' && !parsed) {
  // Робот не прочитал резюме hh (нейросеть не спрашивали): причина и «🔄 Повторить» / «➡️ Без hh»
  const hh = ran('Hh');
  if (!sess || hh?.error === 'stale') show('rs back', '⌛ Эти кнопки устарели.', { back: BACK_RECS }, plan.wait?.messageId || panelId);
  else hhErrorView(hh?.error || 'down', plan.wait?.messageId || panelId);
} else if (plan.route === 'llm' || plan.route === 'robot') {
  if (!parsed?.ok) {
    show('rs retry', `⚠️ Не вышло: ${esc(parsed?.problem ?? 'нейросеть не ответила')}.`, { retry: sess ? `rr:${sess.sid}` : 'rs:view' }, plan.wait?.messageId || panelId);
  } else if (plan.mode === 'analyze') {
    sess.report = { summary: parsed.summary, stats: ran('Build')?.stats ?? null };
    sess.questions = parsed.questions;
    sess.qi = 0;
    sess.answers = [];
    reportView(plan.wait?.messageId || panelId);
  } else if (plan.mode === 'plan') {
    sess.plan = parsed.plan;
    sess.questions = parsed.questions;
    sess.qi = 0;
    sess.answers = [];
    planView(sess.notes.length ? '✏️ Пересобрал план.' : '', plan.wait?.messageId || panelId);
  } else if (plan.mode === 'patch') {
    sess.patches = parsed.patches.map((p) => ({ ...p, state: 'pending' }));
    sess.dropped = parsed.dropped;
    sess.pi = 0;
    if (!sess.patches.length) {
      // moveOn() читает сессию — до того, как она закрыта (иначе TypeError и тревога вместо «🤷 …»)
      const messageId = moveOn();
      state.session = null;
      const lost = parsed.dropped.length;
      show(
        'rs back',
        lost
          ? `🤷 Нейросеть предложила ${lost} ${plural(lost, 'правку', 'правки', 'правок')}, но ни одну не смог привязать к тексту резюме. Попробуй сформулировать просьбу иначе.`
          : '🤷 Нейросеть не нашла, что поменять. Попробуй сформулировать просьбу иначе.',
        { back: BACK_RECS },
        messageId,
      );
    } else {
      const messageId = moveOn();
      patchView(messageId);
    }
  } else if (plan.mode === 'split') {
    sess.cv = parsed.cv;
    sess.problems = parsed.problems;
    sess.fields = splitFields(sess.cv, sess.hh);
    sess.fi = 0;
    if (sess.fields.length) fieldView(plan.wait?.messageId || panelId);
    else {
      sess.skills = skillsInit(sess.cv, sess.hh);
      skillsView(plan.wait?.messageId || panelId);
    }
  } else if (plan.mode === 'rework') {
    const p = parsed.patch;
    sess.patches[sess.pi] = { ...p, state: 'pending', warn: plan.keep && p.kind === 'replace' };
    patchView(panelId, plan.keep && p.kind === 'add' ? '➕ Переписал: старый текст остаётся.' : '✏️ Переделал правку.');
  }
} else if (job.op === 'targets') {
  pickView();
} else if (job.op === 'target') {
  // Plan переключил резюме (или оно то же, или такого нет)
  rootView(job.value === scope.id ? (scope.several ? `📚 Работаем с резюме «${esc(scope.name)}».` : '') : '⚠️ Такого резюме нет.');
} else if (job.op === 'view' || job.op === 'analyze') {
  // analyze сюда — только без профиля: иначе Plan отправил к нейросети
  rootView();
} else if (job.op === 'start' && sess?.started) {
  // Анализ: отчёт остаётся в чате, первый вопрос — новой панелью под ним
  questionView(moveOn('▶️ Начали'));
} else if (job.op === 'upgrade') {
  if (!s['profile.ready'] || !resumeDraft(s).resume) rootView();
  else {
    state.panelId = panelId;
    show(
      'rs back',
      '⬆️ <b>Upgrade резюме</b>\nНапиши ответом на сообщение ниже, что добавить или поменять. Сначала покажу план, куда впишу и что заменю, потом спрошу про каждую правку.',
      { back: BACK_RECS },
    );
    ask('upgrade', 'Например: «Добавь в навыки PHP и напиши, что делал на нём админку на прошлой работе» или «Убери jQuery».');
  }
} else if (job.op === 'undo') {
  if (job.value === 'y') undo();
  else undoView();
} else if (job.op === 'exp' && cvFresh(s)) {
  if (job.value === 'up') {
    state.panelId = panelId;
    expView('⬆️ Напиши ответом на сообщение ниже, что добавить или поменять в опыте работы.');
    ask('exp', 'Например: «В Руб Икс допиши, что делал админку на PHP» или «Сократи описание WillSkill».');
  } else expView();
} else if (job.op === 'export' && !state.session) {
  // 📤 без живой разметки, связанной с hh: сначала разложить резюме вместе с резюме hh
  rootView(
    scope.id !== 'r1' && !scope.link
      ? '🤖 Это резюме не связано с резюме на hh, выгружать некуда. Связать: ⚙️ → 📄 Резюме → 📥 Импорт с hh.'
      : cvFresh(s)
        ? '🤖 Резюме бота не связано с резюме на hh: 💼 разложит его заново вместе с hh (нужен робот).'
        : '📝 Сначала разложи резюме по разделам: нажми 💼.',
  );
} else if (job.op === 'input' && job.field === 'exp') {
  // Сюда — только если сессию не начали: нет разметки или ответ пустой
  rootView(cvFresh(s) ? '' : '📝 Сначала разложи резюме по разделам: нажми 💼.');
} else if (job.op === 'input' && job.field === 'upgrade') {
  // Сюда — только если сессию не начали: профиля нет или ответ пустой
  rootView();
} else if (job.op === 'plan' && job.value === 'y' && sess?.planOk) {
  // План верен, есть вопросы — первый вопрос новой панелью под планом
  questionView(moveOn());
} else if (job.op === 'plan' && job.value === 'e' && sess?.plan) {
  planView('✏️ Напиши ответом на сообщение ниже, что не так.');
  ask('plan', 'Например: «PHP не в компании, а в пет-проектах» или «в навыки не добавляй».');
} else if (job.op === 'plan' && job.value === 'n') {
  rootView('Отменил — резюме прежнее.');
} else if (job.op === 'stop' && !state.session && !plan.stale) {
  rootView('Отменил — резюме прежнее.');
} else if (job.op === 'answer' && job.value === 't' && sess && sess.qi < sess.questions.length) {
  questionView(panelId, '✍️ Напиши ответ ответом на сообщение ниже.');
  ask('answer', sess.questions[sess.qi].text);
} else if (job.op === 'patch' && job.value === 'e' && sess && sess.pi < sess.patches.length) {
  patchView(panelId, '✏️ Напиши ответом на сообщение ниже, как поправить.');
  ask('patch', 'Например: «короче», «без цифр», «напиши, что это пет-проект».');
} else {
  current();
}

return [{ json: out }];
