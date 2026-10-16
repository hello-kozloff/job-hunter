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

// @include n8n/shared/hh-resume.js

const req = $('Build extract').first().json;
const plan = $('Plan').first().json;
// Задание — от «PDF text» (PDF прислали), «HH resume» (резюме с hh) или «Plan» (текст ответом, правка)
const task = (() => {
  for (const name of ['PDF text', 'HH resume']) {
    try {
      const node = $(name).first().json;
      if (node?.toLlm) return node;
    } catch {
      // нода в этом запуске не выполнялась
    }
  }
  return plan;
})();
const got = llmJson($input.first().json, req.provider, task.importing ? 'нажми «🔄 Повторить» через минуту' : 'пришли PDF ещё раз через минуту');
if (got.problem) return [{ json: { ok: false, problem: got.problem } }];
const draft = draftFromAnswer(got.answer, plan.draft ?? {});
if (draft.problem) return [{ json: { ok: false, problem: draft.problem } }];
// Новое резюме (docs/resumes.md): пол, город и имя — факты о человеке, в резюме про другую профессию их может не быть
if (task.inherit) draft.facts = inheritPerson(draft.facts, task.inherit);
// Резюме с hh: роли, формат работы, зарплата и стаж — как человек выбрал на hh (n8n/shared/hh-resume.js)
if (task.hh) applyHhFacts(draft, task.hh);
return [{ json: { ok: true, draft } }];
