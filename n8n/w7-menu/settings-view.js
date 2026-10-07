// W7 · Render — раздел «⚙️ Настройки» панели меню (07.10.2026). Подключается в render.js строкой
// «// @include n8n/w7-menu/settings-view.js», после помощников времени (thaiMsk, hhmm).
// Значения — из таблицы settings плюс изменение этого нажатия: «Setting change» выполнилась раньше (ветка выше).
// Раскладки: settings (корень), set_collect, set_search, set_filter, set_rules, set_blacklist, set_confirm, set_llm.
// Кнопки «▸» — следующее значение по кругу, «✏️» — вопрос со списком (ответ — сообщением).

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
// Чёрный список: строки таблицы blacklist, без только что убранной («Delete ban» выполнилась раньше)
const unbanned = Number(job.unban) || 0;
const blacklist = ranNode('Blacklist').filter((r) => r.id && r.id !== unbanned);

const everyText = (m) => (m % 60 ? `${m} мин` : `${m / 60} ч`);
const pad2 = (n) => String(n).padStart(2, '0');
const periodText = (days) => SEARCH_LABELS.search_period[days] ?? `за ${days} дн.`;
const responsesText = (n) => (n ? `больше ${n}` : 'не отсекать');
const VERDICT_TEXT = { apply: '🟢 apply', maybe: '🟡 maybe', skip: '🔴 skip' };
const providerText = (p) => (p === 'claude' ? 'Claude' : 'Gemini');
const rulesOn = () => Object.keys(FILTER_RULES).filter((id) => !settings['filter.rules_off'].includes(id));
const companies = (n) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} компания`;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? `${n} компании` : `${n} компаний`;
};

// Что сделало это нажатие: «✅ Записал», ошибка ввода списка
function changeNotes() {
  const notes = [];
  if (settingChange) notes.push('✅ Записал');
  if (job.input && !settingChange) {
    const parsed = parseWords(job.input.text);
    if (parsed.error) notes.push(`⚠️ Не записал: ${esc(parsed.error)}. Нажми ✏️ и пришли список ещё раз`);
  }
  return notes;
}

function settingsRootView(note) {
  const sch = collectSchedule;
  const lines = [
    '⚙️ <b>Настройки</b>',
    '',
    `🕐 <b>Сбор</b>: ${describeSchedule(sch)} · ${collectsPerDay(sch)} в сутки${sch.paused ? ' · ⏸ <b>пауза</b>' : ''}`,
    `🔎 <b>Поиск</b>: ${periodText(settings['search.period'])} · везде — ${settings['search.anywhere'].length} сл., в названии — ${settings['search.in_name'].length}`,
    `🧹 <b>Фильтр</b>: правил ${rulesOn().length} из ${Object.keys(FILTER_RULES).length} · отклики — ${responsesText(settings['filter.max_responses'])} · стоп-слов ${settings['filter.stop_words'].length} · ЧС ${blacklist.length}`,
    `🤖 <b>Нейросеть</b>: ${providerText(settings['llm.provider'])} · теневой режим ${settings['llm.shadow'] ? 'вкл' : 'выкл'} · Vue ${VERDICT_ICON[settings['llm.vue']]} · fullstack ${VERDICT_ICON[settings['llm.fullstack']]} · AI на JS/TS ${VERDICT_ICON[settings['llm.ai_js']]} · React Native ${VERDICT_ICON[settings['llm.react_native']]}`,
  ];
  if (note) lines.push('', note);
  return {
    layout: 'settings',
    text: lines.join('\n'),
    b: { collect: { cb: 's:collect' }, search: { cb: 's:search' }, filter: { cb: 's:filter' }, llm: { cb: 's:llm' } },
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

  const notes = changeNotes();
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

function settingsSearchView() {
  const { words, filters } = describeSearch(settings);
  const lines = [
    '🔎 <b>Поиск на hh</b>',
    '',
    `Период: ${periodText(settings['search.period'])}`,
    ...esc(words)
      .split('\n')
      .map((line) => line.replace(/^([^:]+):/, (m, label) => `${label[0].toUpperCase()}${label.slice(1)}:`)),
    filters[0].toUpperCase() + filters.slice(1),
    '',
    'Слова везде в тексте ищутся в названии, описании и навыках; в названии — только в названии. ✏️ — прислать новый список.',
  ];
  const notes = changeNotes();
  if (notes.length) lines.push('', ...notes);
  return {
    layout: 'set_search',
    text: lines.join('\n'),
    b: {
      period: { text: `Период: ${periodText(settings['search.period'])} ▸`, cb: 'sc:search.period' },
      url: searchUrl(0, settings),
    },
  };
}

function settingsFilterView() {
  const off = settings['filter.rules_off'];
  const lines = [
    '🧹 <b>Фильтр</b> — отсекает до нейросети',
    '',
    `Правила: ${Object.entries(FILTER_RULES)
      .map(([id, label]) => `${off.includes(id) ? '◻️' : '✅'} ${label}`)
      .join(' · ')}`,
    `Отклики: ${responsesText(settings['filter.max_responses'])}`,
    `Стоп-слова в названии: ${esc(settings['filter.stop_words'].join(', '))}`,
    `Чёрный список: ${companies(blacklist.length)}`,
  ];
  const notes = changeNotes();
  if (notes.length) lines.push('', ...notes);
  return {
    layout: 'set_filter',
    text: lines.join('\n'),
    b: {
      responses: {
        text: `Отклики: ${settings['filter.max_responses'] ? `> ${settings['filter.max_responses']}` : 'все'} ▸`,
        cb: 'sc:filter.max_responses',
      },
      blacklist: { text: `🚫 Чёрный список · ${blacklist.length}` },
    },
  };
}

function settingsRulesView() {
  const off = settings['filter.rules_off'];
  const ids = Object.keys(FILTER_RULES);
  const lines = [
    '⚙️ <b>Правила фильтра</b>',
    '',
    'Нажми правило, чтобы выключить или включить. ◻️ — правило не работает: такие вакансии дойдут до нейросети.',
  ];
  const notes = changeNotes();
  if (notes.length) lines.push('', ...notes);
  const b = {};
  ids.forEach((id, i) => {
    b[`r${i}`] = { text: `${off.includes(id) ? '◻️' : '✅'} ${FILTER_RULES[id]}`, cb: `st:${id}` };
  });
  return { layout: 'set_rules', text: lines.join('\n'), b };
}

function settingsBlacklistView() {
  const SHOW = 60;
  const lines = [`🚫 <b>Чёрный список</b> — ${blacklist.length}`, ''];
  for (const r of blacklist.slice(0, SHOW)) {
    lines.push(`/bl${r.id} ${esc(r.company)}${r.comment ? ` — ${esc(String(r.comment).slice(0, 60))}` : ''}`);
  }
  if (blacklist.length > SHOW) lines.push(`…и ещё ${blacklist.length - SHOW} — в UI n8n`);
  lines.push('', 'Команда <code>/bl12</code> — убрать компанию. Добавить — кнопкой «🚫 В ЧС» на карточке вакансии.');
  if (unbanned) lines.push('', '🗑 Убрал из чёрного списка');
  return { layout: 'set_blacklist', text: lines.join('\n'), b: {} };
}

function settingsConfirmView(id) {
  const row = blacklist.find((r) => r.id === Number(id));
  if (!row) return { ...settingsBlacklistView(), text: `${settingsBlacklistView().text}\n\n⚠️ Такой строки в чёрном списке нет` };
  return {
    layout: 'set_confirm',
    text: `🚫 Убрать «${esc(row.company)}» из чёрного списка?\nВакансии компании снова пойдут в оценку.`,
    b: { yes: `bld:${row.id}` },
  };
}

function settingsLlmView() {
  const provider = settings['llm.provider'];
  const model = provider === 'claude' ? $env.CLAUDE_MODEL || 'claude-haiku-4-5' : $env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const lines = [
    '🤖 <b>Нейросеть</b>',
    '',
    `Модель: ${providerText(provider)} (${esc(model)}) — оценка вакансий и письма`,
    settings['llm.shadow']
      ? 'Теневой режим: вкл — карточки на все оценки, включая 🔴'
      : 'Теневой режим: выкл — 🔴 без карточек: только в итоге после сбора и в меню на вкладке ❌',
    '',
    'Спорные случаи:',
    `• Vue без React — ${VERDICT_TEXT[settings['llm.vue']]}`,
    `• fullstack (React и бэкенд) — ${VERDICT_TEXT[settings['llm.fullstack']]}`,
    `• разработка на AI на JS/TS — ${VERDICT_TEXT[settings['llm.ai_js']]}`,
    `• React Native — основная работа — ${VERDICT_TEXT[settings['llm.react_native']]}`,
    '',
    'Изменённое решение уходит в промпт «поправкой кандидата»; по умолчанию промпт прежний.',
  ];
  if (provider === 'claude') {
    lines.push('', '⚠️ Для Claude нужен ключ ANTHROPIC_API_KEY в .env и деплой — без него оценка встанет с ошибкой.');
  }
  const notes = changeNotes();
  if (notes.length) lines.push('', ...notes);
  const cycle = (name, label) => ({ text: `${label}: ${VERDICT_ICON[settings[name]]} ▸`, cb: `sc:${name}` });
  return {
    layout: 'set_llm',
    text: lines.join('\n'),
    b: {
      provider: { text: `Модель: ${providerText(provider)} ▸`, cb: 'sc:llm.provider' },
      shadow: { text: `Теневой: ${settings['llm.shadow'] ? 'вкл' : 'выкл'} ▸`, cb: 'sc:llm.shadow' },
      vue: cycle('llm.vue', 'Vue'),
      fullstack: cycle('llm.fullstack', 'Fullstack'),
      ai: cycle('llm.ai_js', 'AI на JS/TS'),
      rn: cycle('llm.react_native', 'React Native'),
    },
  };
}

function settingsView(section) {
  if (section === 'llm') return settingsLlmView();
  if (section === 'collect') return settingsCollectView();
  if (section === 'search') return settingsSearchView();
  if (section === 'filter') return settingsFilterView();
  if (section === 'rules') return settingsRulesView();
  if (section === 'blacklist') return settingsBlacklistView();
  if (section === 'unban') return settingsConfirmView(job.id);
  if (section && section !== 'root') return settingsRootView('🔜 Этот раздел появится в следующем обновлении.');
  return settingsRootView();
}

// Вопрос со списком (ForceReply): ответ узнаёт W3 «Route» по началу текста (SETTING_PROMPTS)
function settingsPrompt(name) {
  return [
    SETTING_PROMPTS[name],
    `Сейчас: ${settings[name].join(', ')}`,
    '',
    'Пришли новый список через запятую — заменю его целиком. «*» в конце слова — любое окончание.',
  ].join('\n');
}
