// W13 · Step — ответ нейросети в сессию, экран панели, сохранение (15.10.2026, docs/recommendations.md).
// Нода: Code, режим «Run Once for All Items».
// Вход: «Job», «Plan» (что уже сделала кнопка человека), «Settings», static data (сессия), а если выполнялись —
//       «Parse» (ответ нейросети) и «Vacancies» (строки вакансий: покрытие навыков).
// Выход: { save: { имя: значение } | null, view: { layout, text, b, messageId } | null, freeze: { messageId, text } | null,
//          prompt: текст | null, deleteIds: [] }
//   save — строки settings (upsert): profile.resume, profile.extra, resume.history;
//   view — панель: messageId — правим это сообщение, 0 — новое (вопросы и правки идут новой панелью под планом);
//   freeze — план остаётся в чате без кнопок (урок 14.10.2026: затёртую сводку онбординга не видели);
//   prompt — вопрос ForceReply (ответ придёт в W13 как op input).

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

// @include n8n/shared/menu.js

// @include n8n/shared/skills.js

// @include n8n/shared/resume.js

const job = $('Job').first().json;
const plan = $('Plan').first().json;
const s = loadSettings($('Settings').all());
const state = $getWorkflowStaticData('global');
const ran = (name) => {
  try {
    return $(name).first().json;
  } catch {
    return null; // нода в этом запуске не выполнялась
  }
};
const rows = (() => {
  try {
    return $('Vacancies')
      .all()
      .map((i) => i.json)
      .filter((r) => r?.id);
  } catch {
    return null;
  }
})();

const out = { save: null, view: null, freeze: null, prompt: null, deleteIds: [] };
const panelId = job.messageId || state.panelId || 0;
if (job.op === 'input') out.deleteIds = [job.userMessageId, job.promptId].filter(Boolean);
const show = (layout, text, b = {}, messageId = panelId) => {
  out.view = { layout, text, b, messageId };
};
const BACK_RECS = { text: '⬅️ Рекомендации', cb: 'rs:view' };
const BY = { upgrade: 'Upgrade', analyze: 'анализ', undo: 'откат' };
const when = (iso) => (Date.parse(iso) ? `${localDM(Date.parse(iso))} ${localHM(Date.parse(iso))}` : '');
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

function ask(field, help) {
  out.prompt = `${RESUME_PROMPTS[field]}\n${help}\nОтветь на это сообщение.`;
}

// ---------- Экраны ----------

function coverageLine(st) {
  if (!st || st.coverage === null) return '🎯 Покрытие навыков появится, когда наберутся вакансии с ключевыми навыками.';
  const basis =
    st.basis === 'target' ? `по ${st.vacancies} вакансиям, которые тебе подходят` : `по ${st.vacancies} вакансиям из поиска (твоих решений пока мало)`;
  return `🎯 Навыки твоих вакансий в резюме: <b>${percent(st.coverage)}</b> — ${basis}`;
}

function rootView(note = '') {
  const d = resumeDraft(s);
  if (!s['profile.ready'] || !d.resume) {
    return show('rs back', '📄 Сначала пришли резюме PDF — без него рекомендовать нечего.', { back: { text: '⬅️ Настройки', cb: 's:root' } });
  }
  const h = s['resume.history'][0];
  const st = rows ? skillStats(rows, resumeJoin(d)) : null;
  const lines = [
    '💡 <b>Рекомендации по резюме</b>',
    '',
    `📄 Резюме: ${num(resumeJoin(d).length)} знаков${h ? ` · последняя правка ${when(h.at)} (${BY[h.by] ?? h.by})` : ''}`,
    coverageLine(st),
    st?.missing.length ? `    нет в резюме: ${esc(st.missing.slice(0, 5).map((x) => x.name).join(' · '))}` : null,
    '',
    '⬆️ <b>Upgrade</b> — напиши, что добавить или поменять: покажу, куда впишу, и спрошу про каждую правку.',
    '📄 <b>Файлом</b> — резюме бота целиком. ↩️ <b>Откатить</b> — вернуть версию до последней правки.',
    note ? `\n${note}` : null,
  ];
  show('rs root', lines.filter((l) => l !== null).join('\n'));
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
  const lines = [
    `✏️ <b>Правка ${sess.pi + 1}/${sess.patches.length}</b> · ${esc(p.where)}`,
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
function moveOn() {
  const sess = state.session;
  if (sess.moved) return panelId;
  sess.moved = true;
  if (sess.planMsg && sess.planText) out.freeze = { messageId: sess.planMsg, text: `${sess.planText}\n\n✅ Верно` };
  return 0;
}

// Итог сессии: сохранить черновик (если резюме не поменялось за это время), версию — в историю для отката
function finish() {
  const sess = state.session;
  state.session = null;
  const failed = sess.patches.filter((p) => p.state === 'fail');
  const failNote = failed.length
    ? `⚠️ Не применил: ${esc(failed.map((p) => `${p.where} (${p.note})`).join('; '))}`
    : null;
  const changed = sess.draft.resume !== sess.original.resume || sess.draft.extra !== sess.original.extra;
  if (!changed) return show('rs back', ['Ничего не поменял — резюме прежнее.', failNote].filter(Boolean).join('\n'), { back: BACK_RECS });
  if (resumeHash(resumeDraft(s)) !== sess.base) {
    return show('rs back', '⚠️ Пока шла правка, резюме поменялось (новый PDF?). Правки не сохранил — начни заново.', { back: BACK_RECS });
  }
  const note = sess.kind === 'upgrade' ? `«${oneLine(sess.instruction, 80)}»` : 'анализ';
  out.save = {
    'resume.history': [{ at: new Date().toISOString(), by: sess.kind, note, resume: sess.original.resume, extra: sess.original.extra }, ...s['resume.history']].slice(0, 5),
  };
  if (sess.draft.resume !== sess.original.resume) out.save['profile.resume'] = sess.draft.resume;
  if (sess.draft.extra !== sess.original.extra) out.save['profile.extra'] = sess.draft.extra;
  const before = rows ? skillStats(rows, resumeJoin(sess.original)) : null;
  const after = rows ? skillStats(rows, resumeJoin(sess.draft)) : null;
  const n = sess.patches.length;
  const lines = [
    `✅ <b>Резюме обновлено</b>: ${sess.applied} из ${n} ${plural(n, 'правки', 'правок', 'правок')}.`,
    before?.coverage != null ? `🎯 Навыки твоих вакансий в резюме: ${percent(before.coverage)} → <b>${percent(after.coverage)}</b>` : null,
    'Новое резюме уже работает в оценке вакансий и в письмах.',
    failNote,
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
function undo() {
  const [h, ...rest] = s['resume.history'];
  if (!h) return rootView('↩️ Откатывать нечего.');
  const cur = resumeDraft(s);
  out.save = {
    'profile.resume': h.resume,
    'profile.extra': h.extra ?? '',
    'resume.history': [{ at: new Date().toISOString(), by: 'undo', note: `до правки ${when(h.at)}`, resume: cur.resume, extra: cur.extra }, ...rest].slice(0, 5),
  };
  Object.assign(s, out.save);
  rootView(`✅ Откатил: резюме — как до правки ${when(h.at)}.`);
}

// Что сейчас в сессии — то и показать
function current() {
  const sess = state.session;
  if (!sess) return rootView();
  if (sess.patches.length) return sess.pi < sess.patches.length ? patchView() : finish();
  if (sess.plan && !sess.planOk) return planView();
  if (sess.qi < sess.questions.length) return questionView();
  return rootView();
}

// ---------- Что пришло ----------

const sess = state.session;
const parsed = plan.route === 'llm' ? ran('Parse') : null;

if (plan.stale) {
  // Кнопка от прошлой сессии: старое сообщение — без кнопок; ответ на старый вопрос — просто удалить
  if (job.messageId) show('rs back', '⌛ Эти кнопки устарели: правка уже закончилась.', { back: BACK_RECS }, job.messageId);
} else if (plan.route === 'llm') {
  if (!parsed?.ok) {
    show('rs retry', `⚠️ Не вышло: ${esc(parsed?.problem ?? 'нейросеть не ответила')}.`, { retry: sess ? `rr:${sess.sid}` : 'rs:view' }, plan.wait?.messageId || panelId);
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
      state.session = null;
      const lost = parsed.dropped.length;
      show(
        'rs back',
        lost
          ? `🤷 Нейросеть предложила ${lost} ${plural(lost, 'правку', 'правки', 'правок')}, но ни одну не смог привязать к тексту резюме. Попробуй сформулировать просьбу иначе.`
          : '🤷 Нейросеть не нашла, что поменять. Попробуй сформулировать просьбу иначе.',
        { back: BACK_RECS },
        moveOn(),
      );
    } else {
      const messageId = moveOn();
      patchView(messageId);
    }
  } else if (plan.mode === 'rework') {
    const p = parsed.patch;
    sess.patches[sess.pi] = { ...p, state: 'pending', warn: plan.keep && p.kind === 'replace' };
    patchView(panelId, plan.keep && p.kind === 'add' ? '➕ Переписал: старый текст остаётся.' : '✏️ Переделал правку.');
  }
} else if (job.op === 'view' || job.op === 'analyze') {
  rootView(job.op === 'analyze' ? '🔍 Анализ резюме появится следующим обновлением.' : '');
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
} else if (job.op === 'stop' && !state.session) {
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
