// Несколько резюме в приложении (16.10.2026, docs/resumes.md). Основное резюме r1 — глобальные ключи settings
// (profile.*, llm.*, search.*), у r2–r5 свои данные в resume.<id>. Потребители (W1, W2, W5) берут настройки
// резюме через resumeSettings() и дальше работают как раньше: у одного резюме результат — те же самые настройки.
// Общий код: строка «// @include n8n/shared/resumes.js» сразу после n8n/shared/settings.js.

const MAX_RESUMES = 5;
const RESUME_IDS = ['r1', 'r2', 'r3', 'r4', 'r5'];
// Резюме, по которым идёт поиск за один сбор: каждое — до двух запросов к hh (удалёнка, офис в городе)
const MAX_SEARCH_RESUMES = 3;

// Список резюме { id, name, active, hh }; s — результат loadSettings. Пока список не сохранён — одно основное:
// название из должности в профиле, привязка к hh — из разметки W13
function resumeList(s) {
  const list = Array.isArray(s.resumes) ? s.resumes : [];
  // Привязка основного резюме к hh: разметка W13 (cv) её создаёт и меняет (💼). Сохранённая в списке — то же резюме hh
  // с названием посвежее (импорт обновляет названия по списку hh), поэтому при том же хеше берём её; другой хеш — резюме
  // перепривязали в W13, берём cv
  const mainHh = s.cv?.resumes?.[0]?.hh ?? null;
  if (list.length) {
    return list.map((r) => (r.id === 'r1' ? { ...r, hh: r.hh && (!mainHh || r.hh.hash === mainHh.hash) ? r.hh : (mainHh ?? r.hh ?? null) } : r));
  }
  return [
    {
      id: 'r1',
      name: String(s['profile.facts']?.position || '').trim().slice(0, 60) || 'Основное',
      active: true,
      hh: mainHh,
    },
  ];
}

const resumeById = (s, id) => resumeList(s).find((r) => r.id === id) ?? null;

// Резюме, по которым идёт сбор
const activeResumes = (s) => resumeList(s).filter((r) => r.active);

// Свободный id для нового резюме (r2–r5) или null, если всё занято
function nextResumeId(s) {
  const used = new Set(resumeList(s).map((r) => r.id));
  return RESUME_IDS.find((id) => !used.has(id)) ?? null;
}

// Чего нет в resume.<id>, у r2–r5 нейтрально, а не как по умолчанию у ключа: умолчания ключей — настройки
// фронтенд-владельца (слова поиска, стоп-слова, спорные случаи), другой профессии они не подходят
const RESUME_NEUTRAL = {
  resume: '',
  extra: '',
  facts: {},
  about: [],
  preset: 'generic',
  rules: {},
  cases: [],
  roles: [],
  in_name: [],
  anywhere: [],
  formats: ['REMOTE'],
  area: null,
  education: ['not_required_or_not_specified'],
  stop_words: [],
  rules_off: ['lead'],
  examples: '',
  prompt: {},
};

// Есть ли у резюме слова для поиска: без них искать нечего (по роли одной — сотни чужих вакансий)
const resumeSearchable = (rs) => rs['search.anywhere'].length + rs['search.in_name'].length > 0;

// Данные резюме из настроек (то, что у r2–r5 лежит в resume.<id>): для клонирования и записи
function resumeData(s) {
  return Object.fromEntries(Object.entries(RESUME_FIELDS).map(([field, key]) => [field, s[key]]));
}

// Ключи settings с разметкой (cv) и версиями для отката (history) резюме id — их ведёт W13. У основного — прежние
// cv и resume.history, у r2–r5 — свои resume.<id>.cv и resume.<id>.history (не в resume.<id>: см. settings.js)
const resumeKeys = (id) =>
  !id || id === 'r1' ? { cv: 'cv', history: 'resume.history' } : { cv: `resume.${id}.cv`, history: `resume.${id}.history` };

// Настройки для резюме id: основное и неизвестное (удалённое, без данных) — сами s, остальные — копия s
// с подменёнными полями (чего нет в resume.<id> — нейтральное значение RESUME_NEUTRAL). Подменяются и cv, и
// resume.history (их читает W13). Копию не передавать в resumeList/resumeById/activeResumes: основное резюме берёт
// привязку к hh из cv, а в копии он чужой — список всегда по исходным настройкам
function resumeSettings(s, id) {
  if (!id || id === 'r1') return s;
  const data = s[`resume.${id}`];
  if (!data || !resumeById(s, id)) return s;
  const out = { ...s };
  for (const [field, key] of Object.entries(RESUME_FIELDS)) {
    out[key] = field in data ? data[field] : RESUME_NEUTRAL[field];
  }
  const keys = resumeKeys(id);
  out.cv = s[keys.cv] ?? null;
  out['resume.history'] = s[keys.history] ?? [];
  return out;
}

// Что записать в settings, чтобы поменять поля резюме id: { имя ключа: значение }.
// r1 — глобальные ключи, r2–r5 — один ключ resume.<id> с дописанными полями
function resumeRows(s, id, patch) {
  if (!id || id === 'r1') {
    return Object.fromEntries(Object.entries(patch).map(([field, value]) => [RESUME_FIELDS[field], value]));
  }
  return { [`resume.${id}`]: { ...(s[`resume.${id}`] ?? {}), ...patch } };
}

// Что записать в settings после правки резюме id в W13 (save — { 'profile.resume' | 'profile.extra' | cv |
// 'resume.history': значение }): основное — как есть, r2–r5 — текст и «Дополнительно» в resume.<id> (с прежними
// полями), разметка и версии — в свои ключи
function resumeSaveRows(s, id, save) {
  if (!id || id === 'r1') return save;
  const keys = resumeKeys(id);
  const out = {};
  const patch = {};
  for (const [key, value] of Object.entries(save)) {
    if (key === 'cv') out[keys.cv] = value;
    else if (key === 'resume.history') out[keys.history] = value;
    else {
      const field = Object.keys(RESUME_FIELDS).find((f) => RESUME_FIELDS[f] === key);
      if (field) patch[field] = value;
    }
  }
  return Object.keys(patch).length ? { ...out, ...resumeRows(s, id, patch) } : out;
}

// Вакансии резюме id: вакансию ведёт то резюме, которое её нашло; без резюме или с удалённым — основное.
// Одно резюме — все строки как есть. s — исходные настройки
function resumeVacancies(s, rows, id) {
  const list = resumeList(s);
  if (list.length < 2) return rows;
  const known = new Set(list.map((r) => r.id));
  return rows.filter((r) => (known.has(r.resume_id) ? r.resume_id : 'r1') === (id || 'r1'));
}

// Резюме, с которым работает W13 (рекомендации): target — выбор человека (static data), удалённое и без данных —
// основное. all — исходные настройки (loadSettings). → { id, name, s — настройки резюме, link — привязка к hh
// ({ hash, title } | null), several — резюме больше одного }
function resumeScope(all, target) {
  const id = target && target !== 'r1' && resumeById(all, target) && all[`resume.${target}`] ? target : 'r1';
  const r = resumeById(all, id);
  return { id, name: r?.name ?? '', s: resumeSettings(all, id), link: r?.hh ?? null, several: resumeList(all).length > 1 };
}
