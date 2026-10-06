// W1 · Format message — текст для Telegram (Parse Mode = HTML).
// Нода: Code, режим «Run Once for All Items».
// Прошедшие фильтр — из «Parse vacancy» (status detailed, или new, если страница не открылась).
// Отсеянные — из «Filter search» и «Parse vacancy», сводкой по причинам.
// Telegram не принимает сообщения длиннее 4096 символов — делим на части до 4000.

const checked = $('Parse vacancy').all().map((i) => i.json);
const passed = checked.filter((r) => r.status !== 'rejected');
const rejected = [
  ...$('Filter search')
    .all()
    .map((i) => i.json)
    .filter((r) => r.status === 'rejected'),
  ...checked.filter((r) => r.status === 'rejected'),
];

// Нечего показать — молчим, отсеянные видны в таблице
if (passed.length === 0) return [];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const EXPERIENCE = { noExperience: 'без опыта', between1And3: '1–3 г.', between3And6: '3–6 л.', moreThan6: '6+ л.' };
const CURRENCY = { RUR: '₽', USD: '$', EUR: '€', KZT: '₸', BYR: 'Br', UZS: 'сум' };
const short = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function salary(r) {
  if (!r.salary_from && !r.salary_to) return '';
  const range =
    r.salary_from && r.salary_to
      ? `${short(r.salary_from)}–${short(r.salary_to)}`
      : r.salary_from
        ? `от ${short(r.salary_from)}`
        : `до ${short(r.salary_to)}`;
  return `💰 ${range} ${CURRENCY[r.currency] ?? r.currency ?? ''}${r.salary_gross ? ' до налогов' : ''}`;
}

// «Москва, Сербия, Грузия, Армения» → «Москва, Сербия +2»
function areas(s) {
  const list = String(s ?? '').split(', ').filter(Boolean);
  return list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', ');
}

const blocks = passed.map((r, i) => {
  const meta = [esc(r.company), salary(r), EXPERIENCE[r.experience] ?? '', esc(areas(r.areas))]
    .filter(Boolean)
    .join(' · ');
  const flags = [
    r.has_test && '📝 тест',
    r.letter_required && '✉️ письмо обязательно',
    r.responses != null && `👥 ${r.responses}`,
    r.error && `⚠️ ${esc(r.error)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return `${i + 1}. <a href="${r.url}">${esc(r.title)}</a>\n${meta}${flags ? `\n${flags}` : ''}`;
});

// Сводка отсеянных: «Vue/Angular 2 · Lead/архитектор 1». Для «только из РФ» цитату не тащим
const counts = {};
for (const r of rejected) {
  for (const reason of String(r.reasons).split(', ').filter(Boolean)) {
    const key = reason.replace(/:.*$/, '');
    counts[key] = (counts[key] ?? 0) + 1;
  }
}
const summary = rejected.length
  ? `\n\n🚫 Отсеяно ${rejected.length}: ${Object.entries(counts)
      .map(([k, n]) => `${esc(k)} ${n}`)
      .join(' · ')}`
  : '';

const messages = [];
let text = `🆕 Подходят: ${passed.length}`;
for (const block of blocks) {
  if (text.length + block.length + 2 > 4000) {
    messages.push(text);
    text = block;
  } else {
    text += `\n\n${block}`;
  }
}
if (text.length + summary.length > 4000) {
  messages.push(text);
  text = summary.trim();
} else {
  text += summary;
}
messages.push(text);

return messages.map((t) => ({ json: { text: t } }));
