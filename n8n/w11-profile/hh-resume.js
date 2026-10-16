// W11 · HH resume — ответ робота на «прочитать резюме hh» (импорт резюме с hh, docs/resumes.md).
// Нода: Code, режим «Run Once for All Items». Вход: «Read hh» (HTTP Request к роботу, полный ответ без исключений;
// нет связи или нет credential — item { error }), «Plan» (mode list | detail, hash, importing, inherit), «Settings».
// Выход → «To LLM?»:
//   список (mode list) — { toLlm: false, hh: 'list' }: список резюме hh уже в static data (imp.list), «Step» покажет галочки;
//   резюме (mode detail) — { toLlm: true, mode: 'extract', text, create: true, inherit, hh, importing }: к нейросети как
//     новое резюме; hh — то, что человек выбрал на hh сам (роли, формат, зарплата, стаж), importing — { hash, title };
//   сбой — { toLlm: false, hhError }: «Step» покажет причину (n8n/shared/hh-resume.js → hhWhy).

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

// @include n8n/shared/resumes.js

// @include n8n/shared/hh-roles.js

// @include n8n/shared/search.js

// @include n8n/shared/profile.js

// @include n8n/shared/hh-resume.js

const plan = $('Plan').first().json;
const s = loadSettings($('Settings').all());
const state = $getWorkflowStaticData('global');
const got = hhOutcome($input.first().json);
if (got.error) return [{ json: { toLlm: false, hhError: got.error, mode: plan.mode } }];

if (plan.mode === 'list') {
  if (state.imp) {
    state.imp.list = (got.body.resumes ?? []).map((r) => ({
      hash: r.hash,
      title: r.title,
      access: r.access,
      updated: r.updated,
      // уже в боте: основное резюме или импортированное раньше
      linked: resumeList(s).find((x) => x.hh?.hash === r.hash)?.id ?? '',
    }));
  }
  return [{ json: { toLlm: false, hh: 'list' } }];
}

const hh = got.body.resume;
if (!hh || hh.hash !== plan.hash) return [{ json: { toLlm: false, hhError: 'not_found', mode: plan.mode } }];
const text = hhResumeText(hh);
// Пустое резюме нейросети не разобрать: скажем, а не придумаем профессию из названия
if (text.length < 150) return [{ json: { toLlm: false, hhError: 'empty', mode: plan.mode } }];
state.text = text;
return [
  {
    json: {
      toLlm: true,
      mode: 'extract',
      text,
      create: true,
      inherit: plan.inherit,
      hh: { roles: hh.roles ?? [], formats: hh.formats ?? [], salary: hh.salary ?? null, months: hh.months ?? 0 },
      importing: plan.importing,
    },
  },
];
