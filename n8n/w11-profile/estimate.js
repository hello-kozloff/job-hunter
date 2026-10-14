// W11 · Estimate parse — сколько вакансий нашёл hh по каждому запросу черновика (для «Вот что я понял»).
// Нода: Code, режим «Run Once for All Items». Вход: ответы «Estimate» (страница поиска, текст в поле data) по порядку
// items «Estimate plan»; если запросов не было — сам item «Estimate plan» { none: true }.
// Выход: { draft, estimate: [{ label, total }] } — total = null, если страница не разобралась (оценка — не главное).

const plans = $('Estimate plan').all().map((i) => i.json);
const draft = plans[0].draft;
if (plans[0].none) return [{ json: { draft, estimate: [] } }];

// HTML-сущности — за один проход, как в n8n/w1-collector/parse-search.js
const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });

const estimate = $input.all().map((item, i) => {
  const html = String(item.json.data ?? item.json.body ?? '');
  const tpl = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
  let total = null;
  if (item.json.statusCode === 200 && tpl) {
    try {
      total = JSON.parse(decode(tpl[1]))?.vacancySearchResult?.totalResults ?? null;
    } catch {
      total = null;
    }
  }
  return { label: plans[i]?.label ?? '', total };
});
return [{ json: { draft, estimate } }];
