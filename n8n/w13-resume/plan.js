// W13 · Plan — событие человека → сессия правки → куда дальше (15.10.2026, docs/recommendations.md).
// Нода: Code, режим «Run Once for All Items». Вход: «Job», «Settings», static data (сессия).
// Выход: { route: llm | file | step, mode, rows, wait, comment, keep, stale }
//   llm  — спросить нейросеть: mode analyze (анализ: отчёт и вопросы) | plan (план Upgrade) | patch (правки) | rework
//          (переделать одну правку, comment — пожелание, keep — «➕ Не заменять, дописать»); wait — { messageId, text }:
//          что показать, пока нейросеть думает;
//   file — резюме файлом;
//   step — остальное: «Step» покажет, что теперь в сессии;
//   rows — нужны строки вакансий (покрытие навыков: панель и итог); stale — кнопка от прошлой сессии.
// Здесь — переходы по кнопкам и ответам человека; ответы нейросети разбирает «Step».
//
// Сессия (static data session): { sid, kind: upgrade | analyze, at, base — отпечаток резюме на старте, original и
//   draft — { resume, extra }, instruction, notes — «не так» к плану, plan, planOk, report — отчёт анализа, started —
//   вопросы анализа начаты, planMsg и planText — сообщение с планом или отчётом, moved — вопросы и правки уже на новой
//   панели, questions, qi, answers, picks — галочки текущего вопроса, patches, pi, dropped, applied, done — итог без
//   правок (ответы только на подсказки), last — последний запрос к нейросети { mode, comment, keep } для «🔄 Повторить» }.
// Вопрос: { text, kind: one | many | text, options, area, hint — подсказка про фильтры hh (ответ — совет, не правка),
//   tip, code: skills | where — вопросы кода про недостающие навыки, names — навыки без частоты }.
// panelId (static data) — сообщение-панель, которую правим.

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

// @include n8n/shared/skills.js

// @include n8n/shared/resume.js

// @include n8n/shared/cv.js

const job = $('Job').first().json;
const s = loadSettings($('Settings').all());
const state = $getWorkflowStaticData('global');
const sess = state.session ?? null;
const out = { route: 'step', mode: '', rows: false, wait: null, comment: '', keep: false, stale: false };
const panel = job.messageId || state.panelId || 0;
// «➕ Не заменять, дописать» — то же, что пожелание к правке
const KEEP_OLD = 'Ничего не убирай из старого текста этого места, только допиши новое.';

function llm(mode, text, messageId = panel, comment = '', keep = false) {
  Object.assign(out, { route: 'llm', mode, comment, keep, wait: messageId ? { messageId, text } : null });
  if (state.session) state.session.last = { mode, comment, keep };
}
const live = Boolean(sess) && job.sid === sess.sid;
function newSession(kind, d) {
  return {
    sid: Math.random().toString(36).slice(2, 6).padEnd(4, '0'),
    kind,
    at: new Date().toISOString(),
    base: resumeHash(d),
    original: d,
    draft: d,
    instruction: '',
    notes: [],
    plan: null,
    planOk: false,
    report: null,
    started: false,
    planMsg: 0,
    planText: '',
    moved: false,
    questions: [],
    qi: 0,
    answers: [],
    picks: [],
    patches: [],
    pi: 0,
    dropped: [],
    applied: 0,
    done: false,
    last: null,
  };
}
// Нужны ли правки: у Upgrade план подтверждён; у анализа есть ответ не на подсказку (подсказки — только советы)
const needsPatches = () =>
  (sess.kind === 'upgrade' && sess.planOk) || sess.answers.some((a, i) => a && !a.skipped && !sess.questions[i]?.hint);
// После вопроса про недостающие навыки — где с ними работал: в общий список навыков или в строку про пет-проекты
const whereQuestion = (names) => ({
  text: `Где ты работал с ${names.join(', ')}? «В работе» — допишу в общий список навыков, «В своих проектах» — в строку про пет-проекты. Можно своими словами, например: «${names[0]}: в такой-то компании».`,
  llmText: 'Где кандидат работал с этими навыками (в работе: общий список навыков; в своих проектах: строка про пет-проекты)',
  kind: 'one',
  options: ['🧰 В работе', '🧪 В своих проектах'],
  area: 'skills',
  hint: false,
  code: 'where',
});
const stale = () => {
  out.stale = true;
};

// Следующий вопрос или — вопросов больше нет — правки (или итог с одними подсказками)
function nextQuestion() {
  sess.qi++;
  sess.picks = [];
  if (sess.qi < sess.questions.length) return;
  if (needsPatches()) llm('patch', '✍️ Готовлю правки…');
  else finishWithout();
}
function finishWithout() {
  sess.done = true;
  out.rows = true;
}
// Следующая правка или — правок больше нет — итог (нужны вакансии: покрытие навыков до и после)
function nextPatch() {
  sess.pi++;
  if (sess.pi >= sess.patches.length) out.rows = true;
}

if (job.op === 'view') {
  out.rows = true;
} else if (job.op === 'file') {
  out.route = 'file';
} else if (job.op === 'undo') {
  // Откат — сразу панель с покрытием; незаконченная правка теряет смысл
  out.rows = job.value === 'y';
  if (job.value === 'y') state.session = null;
} else if (job.op === 'analyze') {
  // Анализ: статистика вакансий (rows) и нейросеть → отчёт и вопросы. Незаконченная сессия заменяется новой
  out.rows = true;
  const d = resumeDraft(s);
  if (s['profile.ready'] && d.resume) {
    state.session = newSession('analyze', d);
    llm('analyze', '⏳ Смотрю резюме глазами ATS и роботов hh… Это до минуты.');
  }
} else if (job.op === 'start') {
  if (!live || sess.kind !== 'analyze' || sess.started || !sess.questions.length) stale();
  else sess.started = true;
} else if (job.op === 'input' && job.field === 'upgrade') {
  const d = resumeDraft(s);
  if (s['profile.ready'] && d.resume && job.text.trim()) {
    state.session = { ...newSession('upgrade', d), instruction: job.text.trim().slice(0, 1500) };
    llm('plan', '⏳ Ищу в резюме, куда это вписать…', state.panelId || 0);
  }
} else if (job.op === 'input' && job.field === 'plan') {
  if (sess?.plan && !sess.planOk) {
    sess.notes.push(job.text.trim().slice(0, 500));
    llm('plan', '⏳ Пересобираю план…', sess.planMsg);
  } else stale();
} else if (job.op === 'input' && job.field === 'answer') {
  if (sess && sess.qi < sess.questions.length && !sess.patches.length && !sess.done) {
    sess.answers[sess.qi] = { text: job.text.trim().slice(0, 1000) };
    nextQuestion();
  } else stale();
} else if (job.op === 'input' && job.field === 'patch') {
  if (sess && sess.pi < sess.patches.length) llm('rework', '⏳ Переделываю правку…', state.panelId, job.text.trim().slice(0, 500));
  else stale();
} else if (job.op === 'plan') {
  if (!live || !sess.plan || sess.planOk) stale();
  else if (job.value === 'y') {
    sess.planOk = true;
    if (!sess.questions.length) llm('patch', `${sess.planText}\n\n✅ Верно. ⏳ Готовлю правки…`, sess.planMsg);
  } else if (job.value === 'n') {
    state.session = null;
    out.rows = true;
  }
} else if (job.op === 'stop') {
  // ⏹ Хватит — только у вопросов: правки по тем ответам, что уже есть (у Upgrade план подтверждён — правки и без них)
  if (!live || sess.patches.length) stale();
  else if (needsPatches()) llm('patch', '✍️ Готовлю правки…');
  else if (sess.answers.some((a) => a && !a.skipped)) finishWithout();
  else {
    state.session = null;
    out.rows = true;
  }
} else if (job.op === 'answer') {
  const q = live && !sess.patches.length && !sess.done && (sess.kind !== 'analyze' || sess.started) ? sess.questions[sess.qi] : null;
  if (!q) stale();
  else if (job.index === sess.qi) {
    if (/^\d$/.test(job.value) && Number(job.value) < q.options.length) {
      const i = Number(job.value);
      if (q.kind === 'many') sess.picks = sess.picks.includes(i) ? sess.picks.filter((x) => x !== i) : [...sess.picks, i];
      else {
        sess.answers[sess.qi] = { picked: [q.options[i]] };
        nextQuestion();
      }
    } else if (job.value === 'k') {
      sess.answers[sess.qi] = { skipped: true };
      nextQuestion();
    } else if (job.value === 'd') {
      sess.answers[sess.qi] = sess.picks.length ? { picked: sess.picks.map((i) => q.options[i]) } : { skipped: true };
      if (q.code === 'skills' && sess.picks.length) sess.questions.splice(sess.qi + 1, 0, whereQuestion(sess.picks.map((i) => q.names[i])));
      nextQuestion();
    }
    // t — «Свой ответ»: вопрос ForceReply задаст «Step»
  }
} else if (job.op === 'patch') {
  const p = live ? sess.patches[sess.pi] : null;
  if (!p) stale();
  else if (job.index === sess.pi) {
    if (job.value === 'y' || job.value === 'r') {
      const r = applyPatch(sess.draft, p);
      if (r.draft) {
        sess.draft = r.draft;
        p.state = 'ok';
        sess.applied++;
      } else {
        p.state = 'fail';
        p.note = PATCH_ERRORS[r.error] ?? r.error;
      }
      nextPatch();
    } else if (job.value === 'n') {
      p.state = 'skip';
      nextPatch();
    } else if (job.value === 'a') {
      llm('rework', '⏳ Дописываю, не убирая старое…', panel, KEEP_OLD, true);
    }
    // e — «Иначе»: вопрос ForceReply задаст «Step»
  }
} else if (job.op === 'retry') {
  if (live && sess.last) llm(sess.last.mode, '⏳ Пробую ещё раз…', panel, sess.last.comment, sess.last.keep);
  else stale();
}

return [{ json: out }];
