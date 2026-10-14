// Время человека (13.10.2026, docs/onboarding.md): часовой пояс — настройка profile.tz (IANA, например Asia/Bangkok),
// иначе пояс компьютера (USER_TZ из .env — его пишет мастер установки), иначе Москва. Расписание сбора по-прежнему
// считается по Москве (n8n/shared/schedule.js): hh публикует вакансии по МСК.
// Общий код: строка «// @include n8n/shared/time.js» — раньше n8n/shared/card.js и n8n/shared/robot.js (им нужен TZ).
// Пояс берётся из ноды «Settings», если она есть в workflow и уже выполнилась; без неё — USER_TZ.

const MSK_TZ = 'Europe/Moscow';
const validTz = (tz) => {
  try {
    return Boolean(tz) && Boolean(new Intl.DateTimeFormat('en-GB', { timeZone: tz }));
  } catch {
    return false;
  }
};

// Пояс этого запуска
function currentTz() {
  let tz = '';
  try {
    const row = $('Settings')
      .all()
      .map((i) => i.json)
      .find((r) => r?.name === 'profile.tz');
    tz = row ? JSON.parse(row.value_json) : '';
  } catch {
    // в workflow нет ноды «Settings» или строка битая — пояс компьютера
  }
  const env = typeof $env === 'undefined' ? '' : $env.USER_TZ;
  return [tz, env, MSK_TZ].find(validTz);
}
const TZ = currentTz();

// Части даты в поясе tz числами: { y, mo, d, h, mi }
function zonedParts(ms, tz = TZ) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}
const pad2 = (n) => String(n).padStart(2, '0');

// 1760340720000 → '14:32'
const localHM = (ms, tz = TZ) => {
  const p = zonedParts(ms, tz);
  return `${pad2(p.h)}:${pad2(p.mi)}`;
};
// → '07.10'
const localDM = (ms, tz = TZ) => {
  const p = zonedParts(ms, tz);
  return `${pad2(p.d)}.${pad2(p.mo)}`;
};
// → '2026-10-07' — ключ дня
const localDay = (ms, tz = TZ) => {
  const p = zonedParts(ms, tz);
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
};
const localHour = (ms, tz = TZ) => zonedParts(ms, tz).h;

// Смещение пояса от UTC в минутах в момент ms (Бангкок: +420)
function tzOffsetMin(ms, tz = TZ) {
  const p = zonedParts(ms, tz);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000) / 60000);
}

// 'UTC+7', 'UTC+5:30', 'UTC−4'
function tzLabel(tz = TZ, ms = Date.now()) {
  const off = tzOffsetMin(ms, tz);
  const abs = Math.abs(off);
  return `UTC${off < 0 ? '−' : '+'}${Math.floor(abs / 60)}${abs % 60 ? `:${pad2(abs % 60)}` : ''}`;
}

// Начало «дня», который начинается в hour:00 по местному: последний такой момент не позже ms
function localDayStart(ms, tz = TZ, hour = 0) {
  const p = zonedParts(ms, tz);
  let start = Date.UTC(p.y, p.mo - 1, p.d, hour) - tzOffsetMin(ms, tz) * 60000;
  if (start > ms) start -= 24 * 3600 * 1000;
  return start;
}

// Тихие часы 23:00–09:00 по местному: карточки и сводка — без звука, тревоги — со звуком
const quietHours = (ms = Date.now(), tz = TZ) => {
  const h = localHour(ms, tz);
  return h >= 23 || h < 9;
};

// Время по местному и в скобках по Москве: '14:32 (10:32 МСК)'; пояс совпадает с Москвой — '10:32 МСК'
const localMsk = (ms, tz = TZ) =>
  tzOffsetMin(ms, tz) === tzOffsetMin(ms, MSK_TZ) ? `${localHM(ms, MSK_TZ)} МСК` : `${localHM(ms, tz)} (${localHM(ms, MSK_TZ)} МСК)`;

// Момент ISO (applied_at) → дата и время по местному: '2026-10-06T21:17:55Z' → '07.10', '04:17'
const localDate = (iso) => (Date.parse(iso) ? localDM(Date.parse(iso)) : '');
const localTime = (iso) => (Date.parse(iso) ? localHM(Date.parse(iso)) : '');
