// W11 · Estimate plan — запросы поиска по черновику: сколько вакансий за период найдёт hh (13.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: черновик из «Area» или «Parse profile», «Settings» (период).
// Выход: item на запрос { label, url, draft } → «Estimate» (HTTP) или [{ none: true, draft }] — запросов нет
// (офис без города): оценивать нечего.

// @include n8n/shared/settings.js

// @include n8n/shared/search.js

// @include n8n/shared/profile.js

function ran(name) {
  try {
    return $(name).first().json;
  } catch {
    return null; // нода в этом запуске не выполнялась
  }
}
const draft = (ran('Area') ?? $('Parse profile').first().json).draft;
const s = loadSettings($('Settings').all());
const ds = {
  ...s,
  'search.roles': draft.search.roles,
  'search.in_name': draft.search.in_name,
  'search.anywhere': draft.search.anywhere,
  'search.formats': draft.facts.formats,
  'search.area': draft.search.area,
  'search.education': educationFilter(draft.facts.education),
};
const queries = searchQueries(ds);
if (!queries.length) return [{ json: { none: true, draft } }];
return queries.map((q) => ({ json: { label: q.label, url: searchUrl(0, ds, q.params), draft } }));
