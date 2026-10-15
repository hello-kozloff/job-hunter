// W13 · Parse — ответ нейросети → проверенный план или правки (15.10.2026, docs/recommendations.md).
// Нода: Code, режим «Run Once for All Items».
// Вход: ответ HTTP Request «Gemini» или «Claude» (полный ответ, без исключений на 4xx/5xx), «Build» (provider, mode),
//       static data (сессия: черновик резюме — по нему проверяются правки).
// Выход: { ok: false, problem } — что показать человеку, или { ok: true, … } по режиму:
//   analyze → summary, questions: сначала вопрос кода про недостающие навыки (галочки, из «Build» stats), потом
//            вопросы нейросети; filters — подсказки (hint: совет поменять на hh, варианты «Поменяю / Оставлю»);
//   plan   → plan { understood, places } (мест может не быть, если есть вопрос), questions [{ text, kind: one | text,
//            options, area, hint }];
//   patch  → patches (n8n/shared/resume.js → checkPatches: old найден ровно один раз, вид add | replace), dropped;
//   rework → patch — одна правка.

// @include n8n/shared/settings.js

// @include n8n/shared/skills.js

// @include n8n/shared/resume.js

// @include n8n/shared/cv.js

// @include n8n/shared/llm.js

const req = $('Build').first().json;
const sess = $getWorkflowStaticData('global').session;
const fail = (problem) => [{ json: { ok: false, problem } }];
const ok = (fields) => [{ json: { ok: true, ...fields } }];

const got = llmJson($input.first().json, req.provider);
if (got.problem) return fail(got.problem);
const a = got.answer ?? {};
if (!sess) return fail('сессия правки закончилась');

// Вопрос с вариантами ответа (2–4, до 40 знаков); вариантов меньше двух — только свой ответ
function toQuestion(q) {
  const text = String(q?.question ?? '').split('\n').map((l) => oneLine(l, 300)).filter(Boolean).join('\n');
  if (!text) return null;
  const options = [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => oneLine(o, 40)).filter(Boolean))].slice(0, 4);
  return { text, kind: options.length >= 2 ? 'one' : 'text', options: options.length >= 2 ? options : [], area: '', hint: false };
}

if (req.mode === 'analyze') {
  const summary = (Array.isArray(a.summary) ? a.summary : []).map((x) => oneLine(x, 200)).filter(Boolean).slice(0, 4);
  const questions = [];
  const missing = req.stats?.missing ?? [];
  if (missing.length) {
    questions.push({
      text: 'Эти навыки часто есть в вакансиях, которые тебе подходят, но их нет в резюме (рядом — в скольких вакансиях). Отметь, с чем работал: в работе или в своих проектах.',
      llmText: 'Навыки из подходящих вакансий, которых нет в резюме: с какими кандидат работал',
      kind: 'many',
      options: missing.map((x) => oneLine(`${x.name} · ${x.freq}`, 40)),
      names: missing.map((x) => x.name),
      area: 'skills',
      hint: false,
      code: 'skills',
    });
  }
  for (const q of (Array.isArray(a.questions) ? a.questions : []).slice(0, req.llmMax ?? 8)) {
    const area = ['title', 'skills', 'experience', 'about', 'filters'].includes(q?.area) ? q.area : 'other';
    const problem = oneLine(q?.problem, 300);
    const question = oneLine(q?.question, 300);
    if (!question) continue;
    const text = [problem, question].filter(Boolean).join('\n');
    if (area === 'filters') {
      // Подсказка: резюме бота не трогаем (решение пользователя 15.10.2026), в итоге — «на hh поменяй сам». Вопрос
      // нейросети не показываем: к нему не подошли бы кнопки «Поменяю / Оставлю»
      const tip = oneLine(q?.tip, 200) || question;
      questions.push({
        text: [problem, `💡 На hh: ${tip}`, 'Поменяешь?'].filter(Boolean).join('\n'),
        llmText: question,
        kind: 'one',
        options: ['✅ Поменяю на hh', '⏭ Оставлю как есть'],
        area,
        hint: true,
        tip,
      });
    } else {
      const base = toQuestion({ question: text, options: q?.options });
      if (base) questions.push({ ...base, llmText: question, area });
    }
  }
  if (!summary.length && !questions.length) return fail('анализ не вышел: нейросеть вернула пустой ответ');
  return ok({ summary, questions: questions.slice(0, 8) });
}
if (req.mode === 'plan') {
  const places = (Array.isArray(a.places) ? a.places : [])
    .slice(0, 5)
    .map((p) => ({ where: oneLine(p?.where, 60), action: p?.action === 'replace' ? 'replace' : 'add', what: oneLine(p?.what, 200) }))
    .filter((p) => p.where && p.what);
  const questions = (Array.isArray(a.questions) ? a.questions : []).slice(0, 2).map(toQuestion).filter(Boolean);
  // Мест нет, но есть вопрос — куда вписать, станет ясно из ответа
  if (!places.length && !questions.length) return fail('не понял, куда это вписать: переформулируй просьбу');
  return ok({ plan: { understood: oneLine(a.understood, 300), places }, questions });
}
if (req.mode === 'patch') return ok(checkPatches(sess.draft, a.patches));

// rework: одна правка
const { patches, dropped } = checkPatches(sess.draft, a.patches, 1);
if (!patches.length) return fail(`переделать правку не вышло: ${PATCH_ERRORS[dropped[0]?.error] ?? 'нейросеть не вернула правку'}`);
return ok({ patch: patches[0] });
