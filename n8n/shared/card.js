// Общий код карточки вакансии в Telegram: W2 «Format card» и W3 «Apply choice».
// В Code-ноду попадает при сборке: строка «// @include n8n/shared/card.js» заменяется этим файлом
// (scripts/build-workflows.mjs, scripts/run-code-node.mjs).

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const EXPERIENCE = { noExperience: 'без опыта', between1And3: '1–3 г.', between3And6: '3–6 л.', moreThan6: '6+ л.' };
const CURRENCY = { RUR: '₽', USD: '$', EUR: '€', KZT: '₸', BYR: 'Br', UZS: 'сум' };

// Решение нейросети (колонка decision)
const VERDICT = { apply: '🟢 apply', maybe: '🟡 maybe', skip: '🔴 skip', error: '⚠️ не оценено' };
// Кнопки пользователя: callback_data = v:<id строки>:<choice>, решение — в колонку my_decision
const CHOICE = { apply: '✅ Откликнусь', maybe: '🤔 Возможно', skip: '❌ Мимо' };
const STATUS_BY_CHOICE = { apply: 'approved', maybe: 'maybe', skip: 'skipped' };

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

// '2026-10-06T13:22:00+0300' → '06.10'
function published(s) {
  const m = String(s ?? '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[1]}` : '';
}

// Момент в UTC (applied_at) → дата по Таиланду (UTC+7): '2026-10-06T21:17:55Z' → '07.10'
const thaiDate = (iso) => (Date.parse(iso) ? published(new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString()) : '');

// Текст карточки (Parse Mode = HTML). Строка «👤 …» появляется после нажатия кнопки,
// «📨 …» — после «Отправил» под письмом (W3, status = applied)
function cardText(r) {
  const date = published(r.published_at);
  const meta = [esc(r.company), salary(r), EXPERIENCE[r.experience] ?? '', esc(areas(r.areas)), date && `📅 ${date}`]
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
  const verdict = `🤖 ${VERDICT[r.decision] ?? esc(r.decision)}${r.llm_reason ? ` — ${esc(r.llm_reason)}` : ''}`;
  const mine = CHOICE[r.my_decision] ? `👤 ${CHOICE[r.my_decision]}` : '';
  const sent = r.status === 'applied' ? `📨 Отклик отправлен${r.applied_at ? ` ${thaiDate(r.applied_at)}` : ''}` : '';
  return [`<a href="${r.url}"><b>${esc(r.title)}</b></a>`, meta, flags, verdict, mine, sent].filter(Boolean).join('\n');
}
