// W11 · Area — город из резюме → регион hh (search.area) по автоподсказке hh.ru (13.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: ответ «Area lookup» ({ items: [{ id, text, parent }] }; сбой —
// { error }), «Parse profile» (черновик). Проверено: Казань → 88, Алматы → 160, Тбилиси → 2758; Белграда в hh нет.
// Выход: { ok: true, draft } — draft.search.area = { id, name } или null с предупреждением (офис не ищем).

const draft = $('Parse profile').first().json.draft;
const res = $input.first().json;
const norm = (t) => String(t ?? '').toLowerCase().replace(/ё/g, 'е').trim();
const items = Array.isArray(res.items) ? res.items : [];
const city = norm(draft.facts.city);
const hit = items.find((i) => norm(i.text) === city) ?? items.find((i) => norm(i.text).startsWith(city));
draft.search.area = hit ? { id: String(hit.id), name: String(hit.text) } : null;
if (!hit) draft.warnings = [...(draft.warnings ?? []), `города «${draft.facts.city}» нет в справочнике hh — офис и гибрид не ищу, только удалёнку`];
return [{ json: { ok: true, draft } }];
