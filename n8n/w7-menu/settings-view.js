// W7 · Render — раздел «⚙️ Настройки» панели меню (07.10.2026). Подключается в render.js строкой
// «// @include n8n/w7-menu/settings-view.js», после помощников времени (localMsk, n8n/shared/time.js).
// Значения — из таблицы settings плюс изменение этого нажатия: «Setting change» выполнилась раньше (ветка выше).
// Раскладки: settings (корень), set_collect, set_search, set_filter, set_rules, set_blacklist, set_confirm, set_llm,
// set_apply (🚀 Робот, этап 6: состояние робота — «Robot health», GET /health робота).
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
// Час по МСК → «ЧЧ:ММ» по местному: пояс человека может отличаться от Москвы и на нецелое число часов (pad2, TZ —
// из n8n/shared/time.js)
const mskDiff = tzOffsetMin(Date.now(), TZ) - tzOffsetMin(Date.now(), MSK_TZ);
const mskHourLocal = (h) => {
  const m = (((h * 60 + mskDiff) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};
const periodText = (days) => SEARCH_LABELS.search_period[days] ?? `за ${days} дн.`;
const responsesText = (n) => (n ? `больше ${n}` : 'не отсекать');
const VERDICT_TEXT = { apply: '🟢 apply', maybe: '🟡 maybe', skip: '🔴 skip' };
const providerText = (p) => (p === 'claude' ? 'Claude' : 'Gemini');
// Правила пресета (у generic — без фронтенд-правил) и включённые из них
const presetRules = () => Object.keys(filterRulesFor(settings['profile.preset']));
const rulesOn = () => presetRules().filter((id) => !settings['filter.rules_off'].includes(id));
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
    const parsed = SETTINGS[job.input.name]?.cases ? parseCases(job.input.text) : parseWords(job.input.text);
    if (parsed.error) notes.push(`⚠️ Не записал: ${esc(parsed.error)}. Нажми ✏️ и пришли список ещё раз`);
  }
  return notes;
}

// Несколько резюме (docs/resumes.md): поиск, фильтр и спорные случаи в этих разделах — основного резюме
const severalResumes = resumeList(settings).length > 1;
const mainResumeNote = severalResumes
  ? '📄 Это настройки основного резюме. У остальных поиск, стоп-слова и спорные случаи свои: ⚙️ → 📄 Резюме.'
  : '';

function settingsRootView(note) {
  const sch = collectSchedule;
  const lines = [
    '⚙️ <b>Настройки</b>',
    '',
    severalResumes ? `📄 <b>Резюме</b>: ${resumeList(settings).length} · ищут ${activeResumes(settings).length}` : null,
    `🕐 <b>Сбор</b>: ${describeSchedule(sch)} · ${collectsPerDay(sch)} в сутки${sch.paused ? ' · ⏸ <b>пауза</b>' : ''}`,
    `🔎 <b>Поиск</b>: ${periodText(settings['search.period'])} · везде — ${settings['search.anywhere'].length} сл., в названии — ${settings['search.in_name'].length}`,
    `🧹 <b>Фильтр</b>: правил ${rulesOn().length} из ${presetRules().length} · отклики — ${responsesText(settings['filter.max_responses'])} · стоп-слов ${settings['filter.stop_words'].length} · ЧС ${blacklist.length}`,
    `🤖 <b>Нейросеть</b>: ${providerText(settings['llm.provider'])} · теневой режим ${settings['llm.shadow'] ? 'вкл' : 'выкл'} · спорных случаев ${settings['llm.cases'].length}`,
    `🚀 <b>Робот</b>: ${settings['apply.enabled'] ? 'вкл' : 'выкл'}${settings['apply.paused'] ? ' · ⏸ пауза' : ''} · сегодня ${robotToday(rows, now)}/${settings['apply.daily_limit']} · ${robotState().short}`,
  ].filter((line) => line !== null);
  if (note) lines.push('', note);
  return {
    layout: 'settings',
    text: lines.join('\n'),
    b: {
      collect: { cb: 's:collect' },
      search: { cb: 's:search' },
      filter: { cb: 's:filter' },
      llm: { cb: 's:llm' },
      apply: { cb: 's:apply' },
    },
  };
}

function settingsCollectView() {
  const sch = collectSchedule;
  const next = nextCollect(now, sch);
  const lines = [
    '🕐 <b>Сбор</b>',
    '',
    `Днём — ${pad2(sch.dayFrom)}:00–${pad2(sch.dayTo)}:00 МСК${mskDiff ? ` (${mskHourLocal(sch.dayFrom)}–${mskHourLocal(sch.dayTo)} у тебя)` : ''}: каждые ${everyText(sch.dayEvery)}`,
    `Ночью: ${sch.nightEvery ? `каждые ${everyText(sch.nightEvery)}` : 'не собирать'}`,
    sch.paused
      ? '⏸ <b>На паузе</b>: сборов нет. «▶️ Возобновить» — и сбор пойдёт по расписанию'
      : `Сборов в сутки: ${collectsPerDay(sch)} · следующий: ${next ? localMsk(next) : '—'}`,
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
  if (job.collectNow) {
    notes.push(settings['profile.ready'] ? '🔄 Запустил сбор — итог придёт сообщением о сборе' : '📄 Сначала пришли резюме в PDF — без профиля искать нечего');
  }
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
    mainResumeNote ? `\n${mainResumeNote}` : null,
  ].filter((line) => line !== null);
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
    `Правила: ${Object.entries(filterRulesFor(settings['profile.preset']))
      .map(([id, label]) => `${off.includes(id) ? '◻️' : '✅'} ${label}`)
      .join(' · ')}`,
    `Отклики: ${responsesText(settings['filter.max_responses'])}`,
    `Стоп-слова в названии: ${esc(settings['filter.stop_words'].join(', '))}`,
    `Чёрный список: ${companies(blacklist.length)}`,
    mainResumeNote ? `\n${mainResumeNote}` : null,
  ].filter((line) => line !== null);
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

// Правила пресета: у frontend — все 10, у остальных — 6, без правил фронтенда (своя раскладка кнопок)
function settingsRulesView() {
  const off = settings['filter.rules_off'];
  const rules = filterRulesFor(settings['profile.preset']);
  const ids = Object.keys(rules);
  const lines = [
    '⚙️ <b>Правила фильтра</b>',
    '',
    'Нажми правило, чтобы выключить или включить. ◻️ — правило не работает: такие вакансии дойдут до нейросети.',
  ];
  const notes = changeNotes();
  if (notes.length) lines.push('', ...notes);
  const b = {};
  ids.forEach((id, i) => {
    b[`r${i}`] = { text: `${off.includes(id) ? '◻️' : '✅'} ${rules[id]}`, cb: `st:${id}` };
  });
  return { layout: ids.length === Object.keys(FILTER_RULES).length ? 'set_rules' : 'set_rules_generic', text: lines.join('\n'), b };
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

// Совпадения теневого режима и с какой минуты они считаются (llm.shadow_since, n8n/shared/shadow.js)
function shadowNote() {
  const since = settings['llm.shadow_since'];
  const { pairs, agree } = shadowStats(rows, since);
  const from = Date.parse(since) ? `с ${localDate(since)} ${localTime(since)}` : 'по всем карточкам';
  return `Совпадения ${from}: ${pairs}/${SHADOW_GOAL}${pairs ? `, совпало ${agree} (${Math.round((agree / pairs) * 100)}%)` : ''}. «🔄 Теневой заново» — считать с этой минуты, оценки не меняются`;
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
    shadowNote(),
    '',
    '<b>Спорные случаи</b> — какое решение ставить:',
    ...(settings['llm.cases'].length
      ? settings['llm.cases'].map((c) => `• ${esc(c.case)} — ${VERDICT_TEXT[c.decision]}`)
      : ['• нет — нейросеть решает по общим правилам']),
    '',
    '✏️ — прислать список «случай: решение» через запятую. Встроенные случаи — Vue без React, fullstack, AI на JS/TS, React Native: убрал из списка — правило не действует, поменял решение — меняется. Новые случаи описывай как угодно, нейросеть их поймёт.',
  ];
  if (provider === 'claude') {
    lines.push('', '⚠️ Для Claude нужен ключ ANTHROPIC_API_KEY в .env и деплой — без него оценка встанет с ошибкой.');
  }
  if (mainResumeNote) lines.push('', 'Модель и теневой режим — общие для всех резюме; спорные случаи ниже — основного.', mainResumeNote);
  const notes = changeNotes();
  if (notes.length) lines.push('', ...notes);
  return {
    layout: 'set_llm',
    text: lines.join('\n'),
    b: {
      provider: { text: `Модель: ${providerText(provider)} ▸`, cb: 'sc:llm.provider' },
      shadow: { text: `Теневой: ${settings['llm.shadow'] ? 'вкл' : 'выкл'} ▸`, cb: 'sc:llm.shadow' },
    },
  };
}

// Состояние робота по GET /health («Robot health»): не отвечает, ждёт (блок), не вошёл, на связи
function robotState() {
  const h = ranNode('Robot health')[0] ?? {};
  if (!h.ok || h.error) return { short: '⚠️ не отвечает', long: '⚠️ не отвечает — запуск: <code>scripts/deploy.sh --applier</code>', up: false };
  const mode = h.fake ? 'фейк' : h.live ? 'боевой' : '🧪 сухой прогон (APPLY_LIVE=0)';
  if (h.blocked) return { short: `⏸ ждёт (${h.blocked.kind})`, long: `⏸ ждёт: ${esc(h.blocked.kind)} — реши в окне робота, потом ▶️ · ${mode}`, up: true };
  if (!h.loggedIn) return { short: '🔑 не вошёл в hh', long: `🔑 не вошёл в hh — <code>node scripts/applier.mjs login</code> · ${mode}`, up: true };
  return { short: '✅ на связи', long: `✅ на связи, вошёл в hh · ${mode}${h.busy ? ` · занят (${esc(h.by ?? '')})` : ''}`, up: true };
}

function settingsApplyView() {
  const on = settings['apply.enabled'];
  const paused = settings['apply.paused'];
  const limit = settings['apply.daily_limit'];
  const lines = [
    '🚀 <b>Робот-отклик</b>',
    '',
    on
      ? `Включён: под новыми письмами — [🚀 Откликнуться роботом]${paused ? '\n⏸ <b>Очередь на паузе</b>: нажатия копятся, робот ждёт' : ''}`
      : 'Выключен: кнопки 🚀 под письмами нет, откликаешься сам',
    `Состояние: ${robotState().long}`,
    `Сегодня: ${robotToday(rows, now)} из ${limit} (день — с 09:00 по местному) · в очереди: ${count(rows, (r) => r.apply_state)}`,
    '',
    `Окно робота — VNC ${VNC_URL} (на Mac — «Общий экран», режим «Управление»; на Windows и Linux — любой VNC-клиент). Капча и вход в hh — там; потом ▶️ или /go.`,
  ];
  const notes = changeNotes();
  if (notes.length) lines.push('', ...notes);
  return {
    layout: 'set_apply',
    text: lines.join('\n'),
    b: {
      enabled: { text: `Робот: ${on ? 'вкл' : 'выкл'} ▸`, cb: 'sc:apply.enabled' },
      paused: { text: paused ? '▶️ Снять паузу' : '⏸ Пауза', cb: 'sc:apply.paused' },
      limit: { text: `Лимит: ${limit} в день ▸`, cb: 'sc:apply.daily_limit' },
    },
  };
}

function settingsView(section) {
  if (section === 'apply') return settingsApplyView();
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
  if (SETTINGS[name].cases) {
    return [
      SETTING_PROMPTS[name],
      `Сейчас: ${esc(casesText(settings[name])) || '—'}`,
      '',
      'Пришли список «случай: решение» через запятую — заменю его целиком. Решение — apply, maybe или skip. ' +
        'Если в описании нужна запятая — разделяй случаи «;» или новой строкой. Очистить — «-».',
      'Пример: <code>Vue без React: apply, fullstack на Node: apply, Angular: maybe</code>',
    ].join('\n');
  }
  return [
    SETTING_PROMPTS[name],
    `Сейчас: ${settings[name].join(', ') || '—'}`,
    '',
    `Пришли новый список через запятую — заменю его целиком. «*» в конце слова — любое окончание.${SETTINGS[name].min === 0 ? ' Очистить — «-».' : ''}`,
  ].join('\n');
}
