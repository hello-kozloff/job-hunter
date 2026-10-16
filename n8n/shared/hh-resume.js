// Резюме с hh → бот (импорт, docs/resumes.md): текст резюме из ответа робота, то, что человек выбрал на hh сам, причины
// сбоев. Общий код W11 («HH resume», «Parse profile», «Step»): строка «// @include n8n/shared/hh-resume.js» после
// n8n/shared/settings.js (WORK_FORMATS), n8n/shared/hh-roles.js (HH_ROLES) и n8n/shared/profile.js (CURRENCIES).
//
// Ответ робота на POST /resume/read: { ok, resumes: [{ hash, title, access, status, updated }], resume: { hash, title,
// about, keySkills, places: [{ company, position, description, start, end }], roles: [{ id, text }], formats, salary,
// months, … } } (applier/src/hh/resume.mjs → parseResume).

const HH_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
// «2025-08-01» → «август 2025»; не дата — пусто
const hhDate = (iso) => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})/);
  return m ? `${HH_MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : '';
};
const hhPlural = (n, one, few, many) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
};
// 61 месяц → «5 лет 1 месяц»
function hhDuration(months) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} ${hhPlural(y, 'год', 'года', 'лет')}`, m && `${m} ${hhPlural(m, 'месяц', 'месяца', 'месяцев')}`].filter(Boolean).join(' ');
}

// Текст резюме для нейросети и для хранения — как в PDF с hh: название, стаж, ключевые навыки, «Обо мне», опыт работы
// (новые места сверху). Опыт — в конце: если текст придётся обрезать, пропадут самые старые места
function hhResumeText(hh) {
  const places = (hh.places ?? []).map((p) => {
    const period = [hhDate(p.start), p.end ? hhDate(p.end) : 'по настоящее время'].filter(Boolean).join(' — ');
    return [`${p.company}${period ? ` — ${period}` : ''}`, p.position, p.description].filter(Boolean).join('\n');
  });
  return [
    hh.title,
    hh.months > 0 ? `Опыт работы — ${hhDuration(hh.months)}` : '',
    hh.keySkills?.length ? `Ключевые навыки\n${hh.keySkills.join(', ')}` : '',
    hh.about ? `Обо мне\n${hh.about}` : '',
    places.length ? `Места работы\n\n${places.join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 30000);
}

// То, что человек выбрал на hh сам, точнее догадок нейросети: роли hh (как в поиске), формат работы, желаемая зарплата,
// стаж. Правит черновик разбора на месте
function applyHhFacts(draft, hh = {}) {
  const roles = (hh.roles ?? []).map((r) => String(r.id)).filter((id) => HH_ROLES[id]).slice(0, 3);
  if (roles.length) draft.search.roles = roles;
  const formats = (hh.formats ?? []).filter((f) => WORK_FORMATS.includes(f));
  if (formats.length) draft.facts.formats = formats;
  if (hh.salary && hh.salary.amount > 0 && CURRENCIES[hh.salary.currency]) {
    draft.facts.salary = { amount: Math.round(hh.salary.amount), currency: hh.salary.currency };
  }
  if (hh.months > 0) draft.facts.years = Math.min(60, Math.round((hh.months / 12) * 10) / 10);
  return draft;
}

// Ответ HTTP Request «Read hh» (полный, без исключений) → { error } или { body }. error: down | busy | blocked:<вид> |
// http:<код> | captcha | login | layout | no_resume | not_found (то, что вернул сам робот)
function hhOutcome(res) {
  const status = Number(res?.statusCode) || 0;
  const body = res?.body ?? null;
  if (!status) return { error: 'down' };
  if (status === 409) return { error: 'busy' };
  if (status === 423) return { error: `blocked:${body?.blocked?.kind ?? ''}` };
  if (status !== 200) return { error: `http:${status}` };
  if (!body?.ok) return { error: String(body?.error ?? 'layout') };
  return { body };
}

// Робот не прочитал hh: почему и что делать
const HH_ERRORS = {
  busy: 'робот сейчас откликается на вакансию — повтори через минуту',
  captcha: 'hh показал капчу: пройди её в окне робота («Общий экран»), потом повтори',
  login: 'робот не вошёл в hh: войди в окне робота, потом повтори',
  layout: 'страница резюме на hh не разобралась (поменялась вёрстка?)',
  no_resume: 'на hh нет ни одного резюме',
  not_found: 'такого резюме на hh уже нет — открой импорт ещё раз',
  empty: 'резюме на hh почти пустое: заполни его на hh или пришли PDF',
  down: 'робот не отвечает: импорт с hh идёт через него — проверь, что он запущен (scripts/deploy.sh --applier)',
};
const hhWhy = (error) =>
  HH_ERRORS[error] ?? (String(error).startsWith('blocked') ? `робот на паузе (${String(error).slice(8) || 'блок'}): сними блок в ⚙️ → 🚀 Робот` : `ошибка робота (${error})`);
