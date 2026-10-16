// Профиль человека (13.10.2026, docs/onboarding.md): ответ нейросети → проверенный черновик → строки settings.
// Общий код W11 Profile (онбординг, правка, новое резюме): строка «// @include n8n/shared/profile.js»
// после n8n/shared/time.js (tzLabel), n8n/shared/card.js (esc), n8n/shared/settings.js (WORD_RE, WORK_FORMATS),
// n8n/shared/hh-roles.js и n8n/shared/search.js (FORMAT_NAMES).
//
// Черновик (draft): { facts, about, search: { roles, in_name, anywhere, stop_words, area }, rules: { skip, maybe,
// apply, ignore } — правила профессии от нейросети, warnings: [] }. Общие правила (страна, офис, английский, ночь,
// зарплата) не хранятся в черновике: их собирает commonRules при сохранении — так они следуют за фактами.

const ENGLISH = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LEVELS = ['none', 'junior', 'middle', 'senior', 'lead'];
const CURRENCIES = { RUR: '₽', KZT: '₸', USD: '$', EUR: '€', UZS: 'сум', BYR: 'Br' };
const EDUCATION_NAMES = { higher: 'высшее', special_secondary: 'среднее специальное', secondary: 'среднее' };
const LEVEL_NAMES = { none: 'без опыта', junior: 'junior', middle: 'middle', senior: 'senior', lead: 'руководитель' };

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (a, n, len = 120) => (Array.isArray(a) ? a : []).map((x) => clip(x, len)).filter(Boolean).slice(0, n);
// Строка правила: без точки в конце, со строчной буквы (если это не аббревиатура)
const ruleLine = (s) => {
  const t = clip(s, 300).replace(/[.;]+$/, '');
  return /^\p{Lu}{2}/u.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
};
// Правила про страну, город, офис, удалёнку, английский, ночь и зарплату — общие (commonRules): строки нейросети о
// них выбрасываем, иначе они спорили бы с общими
const COMMON_TOPIC = /офис|гибрид|удал[её]н|английск|зарплат|оклад|вилк|город|стран[аеуы]|резидент|ночн|часов\S* пояс|переезд|релокац/i;
// Слова уровня — не стоп-слова: «Ведущий бухгалтер» решает нейросеть, а не фильтр кодом
const LEVEL_WORD = /^(главн|ведущ|старш|младш|senior|lead|junior|middle|head|стажер|стажёр|intern)/i;
// Слова поиска: длинные фразы не обрезаем (обрывок испортил бы запрос hh), а отбрасываем — WORD_RE: до 30 знаков
const words = (a, n) => list(a, 30, 200).filter((w) => WORD_RE.test(w)).slice(0, n);
// Слишком общие слова сами по себе (14.10.2026: «менеджер» в названии дал 963 вакансии за сутки) — во фразах их можно
// («менеджер по работе с клиентами»), отдельным словом — нет
const GENERIC_WORD = /^(менеджер|manager|специалист|specialist|сотрудник|работник|employee|эксперт|expert|консультант|оператор|начальник|руководитель|директор|инженер|engineer)$/i;

// Ответ нейросети (схема n8n/w11-profile/build-extract.js) → черновик. Что не прошло проверку — пусто + предупреждение
function draftFromAnswer(answer, previous = {}) {
  const f = answer?.facts ?? {};
  const warnings = [];
  const formats = list(f.formats, 4).filter((x) => WORK_FORMATS.includes(x));
  const salary = Number(f.salary_amount) > 0 && CURRENCIES[f.salary_currency] ? { amount: Math.round(Number(f.salary_amount)), currency: f.salary_currency } : null;
  const facts = {
    name: clip(f.name, 80),
    first_name: clip(f.first_name, 40),
    name_gen: clip(f.name_gen, 40),
    gender: ['m', 'f'].includes(f.gender) ? f.gender : '',
    position: clip(f.position, 80),
    position_gen: clip(f.position_gen, 80).replace(/\s*\([^)]*\)/g, ''),
    level: LEVELS.includes(f.level) ? f.level : 'middle',
    years: Math.max(0, Math.min(60, Math.round((Number(f.years) || 0) * 10) / 10)),
    skills: list(f.skills, 15, 40),
    companies: list(f.companies, 8, 80),
    english: ENGLISH.includes(f.english) ? f.english : '',
    city: clip(f.city, 60),
    country: clip(f.country, 60),
    country_gen: clip(f.country_gen, 60),
    citizenship: clip(f.citizenship, 60),
    formats: formats.length ? formats : ['REMOTE'],
    relocation: Boolean(f.relocation),
    salary,
    education: ['higher', 'special_secondary', 'secondary'].includes(f.education) ? f.education : '',
    contacts: { telegram: /^@\w{4,32}$/.test(clip(f.telegram, 40)) ? clip(f.telegram, 40) : '', email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clip(f.email, 80)) ? clip(f.email, 80) : '' },
  };
  if (!formats.length) warnings.push('формат работы не понял — ищу удалёнку');
  const roles = list(answer?.search?.roles, 5, 6).filter((id) => /^\d+$/.test(id) && HH_ROLES[id]).slice(0, 3);
  if (!roles.length) warnings.push('профессию в справочнике hh не нашёл — ищу по словам без роли');
  const inName = words(answer?.search?.in_name, 15).filter((w) => !GENERIC_WORD.test(w.trim()));
  // Стоп-слово не должно резать выбранные роли (роль «Менеджер по продажам» и стоп-слово «продаж» спорили)
  const roleText = roles.map((id) => HH_ROLES[id]).join(' ').toLowerCase();
  const stop = words(answer?.search?.stop_words, 10).filter((w) => !LEVEL_WORD.test(w) && !roleText.includes(w.replace(/\*$/, '').toLowerCase()));
  // «Везде в тексте» шире названия в разы — только если слов для названия мало
  const anywhere = inName.length >= 3 ? [] : words(answer?.search?.anywhere, 3);
  const rules = Object.fromEntries(
    ['skip', 'maybe', 'apply', 'ignore'].map((k) => [k, list(answer?.rules?.[k], 8, 300).map(ruleLine).filter((l) => l && !COMMON_TOPIC.test(l))]),
  );
  const draft = {
    facts,
    about: list(answer?.about, 5, 400),
    search: {
      roles,
      in_name: inName,
      anywhere,
      stop_words: stop,
      area: previous.search?.area ?? null,
    },
    rules,
    warnings,
  };
  if (!facts.position && !draft.about.length) draft.problem = 'не похоже на резюме: не нашёл ни должности, ни опыта';
  else if (!inName.length && !draft.search.anywhere.length) draft.problem = 'не понял, какие вакансии искать: нет слов для поиска';
  return draft;
}

// Английский: на 2 уровня выше — skip, на 1 — maybe; C1 и выше — без правил; неизвестен — B2+ спорно
function englishRules(level) {
  const i = ENGLISH.indexOf(level);
  if (i < 0) return { skip: [], maybe: ['нужен английский B2 и выше'] };
  if (i >= 4) return { skip: [], maybe: [] };
  return {
    skip: [`нужен английский ${ENGLISH[i + 2]} и выше или вся коммуникация в команде только на английском`],
    maybe: [`нужен английский ${ENGLISH[i + 1]}`],
  };
}
const moneyText = (s) => (s ? `${String(s.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${CURRENCIES[s.currency] ?? s.currency}` : '');

// Общие правила из фактов: одинаковые у всех, правила профессии — от нейросети. tz — пояс человека (n8n/shared/time.js)
function commonRules(facts, tz) {
  const f = facts;
  const office = f.formats.some((x) => x !== 'REMOTE');
  const remoteOnly = !office;
  const en = englishRules(f.english);
  const skip = [
    f.country && `прямо написано, что нужно жить в другой стране или регионе (кандидат живёт: ${f.city ? `${f.city}, ` : ''}${f.country}) или быть её налоговым резидентом`,
    remoteOnly && 'нужно приезжать в офис, даже изредка',
    office && f.city && `офис или гибрид не в городе ${f.city}`,
    ...en.skip,
    `прямо написано, что работать нужно ночью по времени кандидата (${tzLabel(tz)})`,
  ];
  const maybe = [
    ...en.maybe,
    'есть мягкий признак привязки к стране или офису: «желательно», «будет плюсом», «предпочтительно»',
    f.salary && `в вакансии указана зарплата заметно ниже желаемой (${moneyText(f.salary)}); без вилки — не влияет`,
    'в тексте слишком мало данных, чтобы решить',
  ];
  const notes = [
    office
      ? `Город, где вакансия размещена на hh, важен только для офиса и гибрида: такие вакансии подходят в городе ${f.city || 'кандидата'}. Для удалённой работы город — не требование.`
      : 'Города, где вакансия размещена на hh, — не требование к месту жительства.',
  ];
  return { skip: skip.filter(Boolean), maybe: maybe.filter(Boolean), notes };
}

// Правила фильтра W1 по фактам (generic): lead — выключен (у многих профессий «руководитель» — и есть работа),
// без опыта и junior — не отсекать у новичков, «только из РФ» — не отсекать у живущих в России
function rulesOffFor(facts) {
  const off = ['lead'];
  if (['none', 'junior'].includes(facts.level)) off.push('no_exp', 'junior');
  if (/^(россия|рф|russia)$/i.test(facts.country)) off.push('only_rf');
  return off;
}

// Фильтр образования hh по резюме: высшее — без фильтра
function educationFilter(education) {
  if (education === 'higher') return [];
  if (education === 'special_secondary') return ['not_required_or_not_specified', 'special_secondary'];
  return ['not_required_or_not_specified'];
}

// Строка контакта по умолчанию: Telegram из резюме → username из Telegram → e-mail
function defaultContact(facts, username) {
  const tg = facts.contacts?.telegram || (username ? `@${username}` : '');
  if (tg) return `Для быстрой связи тг: ${tg}`;
  return facts.contacts?.email ? `Почта: ${facts.contacts.email}` : '';
}

// Черновик → значения настроек (имя → значение) для upsert в settings. extra — подпись, контакт, пояс, резюме
function profileRows(draft, { resume, signature, contact, tz }) {
  const f = draft.facts;
  const common = commonRules(f, tz);
  return {
    'profile.preset': 'generic',
    'profile.resume': resume,
    'profile.facts': f,
    'profile.about': draft.about,
    'profile.signature': signature,
    'profile.contact': contact,
    'profile.tz': tz,
    'llm.rules': {
      skip: [...draft.rules.skip, ...common.skip],
      maybe: [...draft.rules.maybe, ...common.maybe],
      apply: draft.rules.apply,
      ignore: draft.rules.ignore,
      notes: common.notes,
    },
    'llm.cases': [],
    'search.roles': draft.search.roles,
    'search.in_name': draft.search.in_name,
    'search.anywhere': draft.search.anywhere,
    'search.formats': f.formats,
    'search.area': draft.search.area,
    'search.education': educationFilter(f.education),
    'filter.stop_words': draft.search.stop_words,
    'filter.rules_off': rulesOffFor(f),
  };
}

// Несколько резюме (docs/resumes.md): факты о самом человеке не зависят от резюме. Новое резюме про другую профессию
// может их не называть (пол, город, имя) — берём у основного, чтобы письма и правила не потеряли пол и город
const PERSON_FACTS = ['name', 'first_name', 'name_gen', 'gender', 'city', 'country', 'country_gen', 'citizenship', 'english', 'education'];
function inheritPerson(facts, main = {}) {
  const out = { ...facts, contacts: { ...(facts.contacts ?? {}) } };
  for (const key of PERSON_FACTS) if (!out[key] && main[key]) out[key] = main[key];
  for (const key of ['telegram', 'email']) if (!out.contacts[key] && main.contacts?.[key]) out.contacts[key] = main.contacts[key];
  return out;
}

// Черновик → данные одного резюме (resume.<id>): то же, что profileRows пишет в глобальные ключи, но только поля
// самого резюме (n8n/shared/settings.js → RESUME_FIELDS). Подпись, контакт и пояс — общие, в резюме не пишутся;
// keep — поля, которые правка черновика не трогает (дополнительно, образцы писем, свои спорные случаи)
function resumeFromDraft(draft, { resume, tz, keep = {} }) {
  const rows = profileRows(draft, { resume, signature: '', contact: '', tz });
  const data = {};
  for (const [field, key] of Object.entries(RESUME_FIELDS)) if (key in rows) data[field] = rows[key];
  return { ...data, ...keep };
}

// «Вот что я понял» — сводка черновика для панели онбординга. estimate — { label: число вакансий за период }
function profileSummary(draft, estimate = []) {
  const f = draft.facts;
  const formats = f.formats.map((x) => FORMAT_NAMES[x]).join(', ');
  const office = f.formats.some((x) => x !== 'REMOTE');
  const wide = estimate.reduce((n, e) => n + (e.total ?? 0), 0);
  const lines = [
    wide > 150
      ? `⚠️ <b>Широкий поиск: ~${wide} вакансий за сутки.</b> Нейросети придётся оценивать много, и мусора будет много. Лучше сузить: «✏️ Поправить» → например «ищи только в названии: координатор, ассистент руководителя».\n`
      : null,
    `👤 <b>${esc(f.name || 'Без имени')}</b> · ${esc(f.position || '—')} · ${LEVEL_NAMES[f.level]}${f.years ? `, ${f.years} г.` : ''}`,
    f.skills.length ? `🧰 ${esc(f.skills.slice(0, 8).join(', '))}` : null,
    `📍 ${esc([f.city, f.country].filter(Boolean).join(', ') || 'город не указан')} · ${esc(formats)}${office && !draft.search.area ? ' · ⚠️ город для офиса на hh не нашёл — офис не ищу' : ''}`,
    `🗣 Английский: ${f.english || 'не указан'}${f.salary ? ` · 💰 от ${moneyText(f.salary)}` : ''}${f.education ? ` · 🎓 ${EDUCATION_NAMES[f.education]}` : ''}`,
    '',
    '🔎 <b>Ищу на hh</b>',
    `• роли: ${esc(draft.search.roles.map((id) => HH_ROLES[id]).join(', ') || 'любые')}`,
    `• в названии: ${esc(draft.search.in_name.join(' · ') || '—')}`,
    draft.search.anywhere.length ? `• везде в тексте: ${esc(draft.search.anywhere.join(' · '))}` : null,
    draft.search.stop_words.length ? `• мимо, если в названии: ${esc(draft.search.stop_words.join(' · '))}` : null,
    estimate.length ? `• за сутки на hh: ${estimate.map((e) => `${esc(e.label)} — ${e.total ?? '?'}`).join(' · ')}` : null,
    '',
    '📜 <b>Правила оценки</b>',
    draft.rules.apply.length ? `🟢 ${esc(draft.rules.apply.join('; '))}` : null,
    draft.rules.maybe.length ? `🟡 ${esc(draft.rules.maybe.join('; '))}` : null,
    draft.rules.skip.length ? `🔴 ${esc(draft.rules.skip.join('; '))}` : null,
    '<i>+ общие: страна и город, офис, английский, ночные часы, зарплата</i>',
    ...(draft.warnings ?? []).map((w) => `⚠️ ${esc(w)}`),
  ];
  return lines.filter((l) => l !== null).join('\n');
}

// Часовой пояс из ответа человека: «UTC+2», «МСК+4», IANA («Europe/Belgrade») или город из списка → IANA или ''.
// Смещение — Etc/GMT с обратным знаком (UTC+4 = Etc/GMT-4): без перехода на летнее время
const CITY_TZ = {
  москва: 'Europe/Moscow', 'санкт-петербург': 'Europe/Moscow', питер: 'Europe/Moscow', казань: 'Europe/Moscow',
  калининград: 'Europe/Kaliningrad', самара: 'Europe/Samara', екатеринбург: 'Asia/Yekaterinburg', новосибирск: 'Asia/Novosibirsk',
  красноярск: 'Asia/Krasnoyarsk', иркутск: 'Asia/Irkutsk', владивосток: 'Asia/Vladivostok', минск: 'Europe/Minsk', киев: 'Europe/Kyiv',
  тбилиси: 'Asia/Tbilisi', батуми: 'Asia/Tbilisi', ереван: 'Asia/Yerevan', баку: 'Asia/Baku', алматы: 'Asia/Almaty', астана: 'Asia/Almaty',
  ташкент: 'Asia/Tashkent', бишкек: 'Asia/Bishkek', белград: 'Europe/Belgrade', 'нови-сад': 'Europe/Belgrade', подгорица: 'Europe/Podgorica',
  будва: 'Europe/Podgorica', стамбул: 'Europe/Istanbul', анталья: 'Europe/Istanbul', лимассол: 'Asia/Nicosia', кипр: 'Asia/Nicosia',
  берлин: 'Europe/Berlin', варшава: 'Europe/Warsaw', прага: 'Europe/Prague', рига: 'Europe/Riga', вильнюс: 'Europe/Vilnius',
  таллин: 'Europe/Tallinn', лиссабон: 'Europe/Lisbon', барселона: 'Europe/Madrid', дубай: 'Asia/Dubai', бангкок: 'Asia/Bangkok',
  пхукет: 'Asia/Bangkok', паттайя: 'Asia/Bangkok', самуи: 'Asia/Bangkok', бали: 'Asia/Makassar', хошимин: 'Asia/Ho_Chi_Minh',
  нячанг: 'Asia/Ho_Chi_Minh', дананг: 'Asia/Ho_Chi_Minh', 'куала-лумпур': 'Asia/Kuala_Lumpur', сингапур: 'Asia/Singapore',
};
function parseTz(text) {
  const t = clip(text, 60);
  const offset = t.match(/^(utc|gmt|мск|msk)?\s*([+\-−])\s*(\d{1,2})$/i);
  if (offset) {
    const sign = offset[2] === '+' ? 1 : -1;
    const hours = sign * Number(offset[3]) + (/^(мск|msk)$/i.test(offset[1] ?? '') ? 3 : 0);
    if (hours === 0) return 'Etc/GMT';
    const tz = `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`;
    return validTz(tz) ? tz : '';
  }
  if (/^(мск|msk|москва)$/i.test(t)) return 'Europe/Moscow';
  if (/^[A-Za-z]+\/[A-Za-z_\-]+(\/[A-Za-z_\-]+)?$/.test(t) && validTz(t)) return t;
  return CITY_TZ[t.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '-')] ?? CITY_TZ[t.toLowerCase().replace(/ё/g, 'е')] ?? '';
}

