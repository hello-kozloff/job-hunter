// W7 · Render — раздел «⚙️ Настройки» панели меню (07.10.2026). Подключается в render.js строкой
// «// @include n8n/w7-menu/settings-view.js», после помощников времени (thaiMsk, hhmm).
// Значения — из таблицы settings плюс изменение этого нажатия: «Setting change» выполнилась раньше (ветка выше).
// Раскладки: settings (корень, 4 раздела) и set_collect (🕐 Сбор). Кнопки «▸» — следующее значение по кругу.

const ranNode = (name) => {
  try {
    return $(name)
      .all()
      .map((i) => i.json);
  } catch {
    return []; // нода в этом запуске не выполнялась
  }
};
const settingChange = ranNode('Setting change')[0];
const settings = {
  ...loadSettings($('Settings').all()),
  ...(settingChange ? { [settingChange.name]: settingChange.value } : {}),
};
const collectSchedule = scheduleFrom(settings);

const everyText = (m) => (m % 60 ? `${m} мин` : `${m / 60} ч`);
const pad2 = (n) => String(n).padStart(2, '0');

function settingsRootView(note) {
  const sch = collectSchedule;
  const lines = [
    '⚙️ <b>Настройки</b>',
    '',
    `🕐 <b>Сбор</b>: ${describeSchedule(sch)} · ${collectsPerDay(sch)} в сутки${sch.paused ? ' · ⏸ <b>пауза</b>' : ''}`,
    '🔎 Поиск · 🧹 Фильтр · 🤖 Нейросеть — в следующем обновлении',
  ];
  if (note) lines.push('', note);
  return {
    layout: 'settings',
    text: lines.join('\n'),
    b: {
      collect: { cb: 's:collect' },
      search: { cb: 's:search' },
      filter: { cb: 's:filter' },
      llm: { cb: 's:llm' },
    },
  };
}

function settingsCollectView() {
  const sch = collectSchedule;
  const next = nextCollect(now, sch);
  const lines = [
    '🕐 <b>Сбор</b>',
    '',
    `Днём — ${pad2(sch.dayFrom)}:00–${pad2(sch.dayTo)}:00 МСК (${pad2((sch.dayFrom + 4) % 24)}:00–${pad2((sch.dayTo + 4) % 24)}:00 у тебя): каждые ${everyText(sch.dayEvery)}`,
    `Ночью: ${sch.nightEvery ? `каждые ${everyText(sch.nightEvery)}` : 'не собирать'}`,
    sch.paused
      ? '⏸ <b>На паузе</b>: сборов нет. «▶️ Возобновить» — и сбор пойдёт по расписанию'
      : `Сборов в сутки: ${collectsPerDay(sch)} · следующий: ${next ? thaiMsk(next) : '—'}`,
  ];

  // Что сделало это нажатие
  const notes = [];
  if (settingChange) notes.push('✅ Записал');
  const hc = ranNode('HC sync')[0];
  if (hc) {
    const error = hc.error ? String(hc.error.message ?? hc.error) : '';
    if (!error) {
      notes.push(sch.paused ? '🛡 Страж healthchecks на паузе' : '🛡 Страж healthchecks: расписание обновлено');
    } else if (/credential/i.test(error)) {
      notes.push('⚠️ Страж healthchecks не обновлён: нет ключа API — HC_API_KEY в .env, потом деплой');
    } else {
      notes.push(`⚠️ Страж healthchecks не обновлён: ${esc(error.slice(0, 120))}`);
    }
  }
  if (job.collectNow) notes.push('🔄 Запустил сбор — итог придёт сообщением о сборе');
  if (notes.length) lines.push('', ...notes);

  return {
    layout: 'set_collect',
    text: lines.join('\n'),
    b: {
      day: { text: `Днём: ${everyText(sch.dayEvery)} ▸`, cb: 'sc:collect.day_every' },
      night: { text: `Ночью: ${sch.nightEvery ? everyText(sch.nightEvery) : 'выкл'} ▸`, cb: 'sc:collect.night_every' },
      window: { text: `День: ${pad2(sch.dayFrom)}–${pad2(sch.dayTo)} МСК ▸`, cb: 'sc:collect.day_window' },
      pause: { text: sch.paused ? '▶️ Возобновить' : '⏸ Пауза', cb: 'sc:collect.paused' },
    },
  };
}

function settingsView(section) {
  if (section === 'collect') return settingsCollectView();
  if (section && section !== 'root') return settingsRootView('🔜 Этот раздел появится в следующем обновлении.');
  return settingsRootView();
}
