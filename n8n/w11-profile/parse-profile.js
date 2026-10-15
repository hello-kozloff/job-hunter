// W11 · Parse profile — ответ нейросети → проверенный черновик профиля (n8n/shared/profile.js → draftFromAnswer).
// Нода: Code, режим «Run Once for All Items».
// Вход: ответ HTTP Request «Gemini» или «Claude» (полный ответ, без исключений на 4xx/5xx), «Build extract»
//       (provider, mode), «Plan» (draft — прежний черновик при правке: город для офиса берётся из него).
// Выход: { ok: true, draft } или { ok: false, problem } — что показать человеку.

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

// @include n8n/shared/hh-roles.js

// @include n8n/shared/search.js

// @include n8n/shared/profile.js

// @include n8n/shared/llm.js

const req = $('Build extract').first().json;
const plan = $('Plan').first().json;
const got = llmJson($input.first().json, req.provider, 'пришли PDF ещё раз через минуту');
if (got.problem) return [{ json: { ok: false, problem: got.problem } }];
const draft = draftFromAnswer(got.answer, plan.draft ?? {});
if (draft.problem) return [{ json: { ok: false, problem: draft.problem } }];
// Новое резюме (docs/resumes.md): пол, город и имя — факты о человеке, в резюме про другую профессию их может не быть.
// Задание — от «PDF text» (PDF прислали) или «Plan» (текст ответом, правка)
const task = (() => {
  try {
    const pdf = $('PDF text').first().json;
    return pdf?.toLlm ? pdf : plan;
  } catch {
    return plan; // PDF в этом запуске не присылали
  }
})();
if (task.inherit) draft.facts = inheritPerson(draft.facts, task.inherit);
return [{ json: { ok: true, draft } }];
