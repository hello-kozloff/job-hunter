// W13 · Parse — ответ нейросети → проверенный план или правки (15.10.2026, docs/recommendations.md).
// Нода: Code, режим «Run Once for All Items».
// Вход: ответ HTTP Request «Gemini» или «Claude» (полный ответ, без исключений на 4xx/5xx), «Build» (provider, mode),
//       static data (сессия: черновик резюме — по нему проверяются правки).
// Выход: { ok: false, problem } — что показать человеку, или { ok: true, … } по режиму:
//   plan   → plan { understood, places } (мест может не быть, если есть вопрос), questions [{ text, kind: one | text,
//            options, area, hint }];
//   patch  → patches (n8n/shared/resume.js → checkPatches: old найден ровно один раз, вид add | replace), dropped;
//   rework → patch — одна правка.

// @include n8n/shared/settings.js

// @include n8n/shared/skills.js

// @include n8n/shared/resume.js

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
  const text = oneLine(q?.question, 300);
  if (!text) return null;
  const options = [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => oneLine(o, 40)).filter(Boolean))].slice(0, 4);
  return { text, kind: options.length >= 2 ? 'one' : 'text', options: options.length >= 2 ? options : [], area: '', hint: false };
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
