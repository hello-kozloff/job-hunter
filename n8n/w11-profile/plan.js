// W11 · Plan — какой путь: скачать PDF, спросить нейросеть или просто шаг онбординга (13.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Job», «Settings», static data (черновик онбординга).
// Выход: { route: pdf | llm | hh | step, mode: extract | revise, text, draft, instruction }:
//   pdf  — документ PDF: скачать и достать текст («PDF text» решит, нужна ли нейросеть);
//   llm  — «🔄 Всё заново» по новому резюме (extract, текст из static data) или «✏️ Поправить» (revise, пожелание);
//   hh   — импорт резюме с hh (docs/resumes.md): робот читает список (mode list) или одно резюме (mode detail, hash),
//          wait — что показать на панели, пока читает, inherit — факты о человеке, importing — { hash, title };
//   step — остальное: кнопки шагов, вопросы, сохранение («Step»).
// Несколько резюме (docs/resumes.md): новое резюме — PDF («➕ Как новое резюме», pf:new:add) или текст ответом на вопрос
// «➕ Новое резюме» (op input, field newresume): create = true, inherit — факты о человеке (пол, город, имя), которых
// может не быть в резюме про другую профессию. Правка («✏️ Поправить») — резюме, чью карточку открыли (state.target).
// Static data (global): draft — черновик профиля, text — текст резюме, pending — новое резюме, step, mode, panelId,
// target — резюме, чью карточку открыли ('' — основное), await — ждём PDF для нового резюме или замены текста,
// imp — импорт с hh: { sid, list, selected, queue, current, saved, skipped }, draftHh — резюме hh, из которого
// получен черновик. Очередь импорта идёт по нажатиям человека («Дальше»), а не цепочкой запусков: так static data
// каждый раз успевает сохраниться.

// @include n8n/shared/settings.js

// @include n8n/shared/resumes.js

const job = $('Job').first().json;
const s = loadSettings($('Settings').all());
const state = $getWorkflowStaticData('global');

// Выгрузка резюме с hh весит сотни КБ; Telegram отдаёт ботам файлы до 20 МБ
if (job.op === 'pdf' && job.file?.size > 5 * 1024 * 1024) {
  return [{ json: { route: 'step', problem: 'PDF больше 5 МБ — пришли выгрузку резюме с hh: «Мои резюме» → резюме → «Скачать» → PDF' } }];
}
if (job.op === 'pdf') return [{ json: { route: 'pdf' } }];
if (job.op === 'replace' && job.value === 'all' && state.pending?.text) {
  // Новый текст другого резюме (не основного): пол, город и имя — как у основного
  return [{ json: { route: 'llm', mode: 'extract', text: state.pending.text, ...(state.pending.target && { inherit: s['profile.facts'] }) } }];
}
// Импорт резюме с hh: «📥 Импорт с hh» (rm:imp) → список; галочки и «Импортировать» (rm:i:<sid>:…) → по одному резюме
if (job.op === 'rm' && job.field === 'imp') {
  if (!nextResumeId(s)) return [{ json: { route: 'step', problem: `уже ${MAX_RESUMES} резюме — это предел. Удали ненужное: ⚙️ → 📄 Резюме` } }];
  const sid = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  state.imp = { sid, list: [], selected: [], queue: [], current: null, saved: [], skipped: [] };
  return [{ json: { route: 'hh', mode: 'list', wait: { messageId: job.messageId, text: '⏳ Читаю список резюме на hh…' } } }];
}
if (job.op === 'rm' && job.field === 'i') {
  const [sid, arg] = job.value.split(':');
  const imp = state.imp;
  if (imp && imp.sid === sid) {
    // Прочитать резюме из очереди (или то же ещё раз) и отдать нейросети как новое
    const read = (item, queueLeft) => {
      imp.current = { hash: item.hash, title: item.title };
      const n = imp.saved.length + imp.skipped.length + 1;
      return [
        {
          json: {
            route: 'hh',
            mode: 'detail',
            hash: item.hash,
            importing: imp.current,
            inherit: s['profile.facts'],
            wait: { messageId: job.messageId, text: `⏳ Читаю «${item.title}» на hh… (${n} из ${n + queueLeft})` },
          },
        },
      ];
    };
    const item = (hash) => imp.list.find((r) => r.hash === hash);
    if (arg === 'go') {
      // Выбранные, которых ещё нет в боте, — не больше свободных мест
      const free = MAX_RESUMES - resumeList(s).length;
      imp.queue = imp.selected.filter((hash) => item(hash) && !item(hash).linked).slice(0, free);
    }
    if (arg === 'retry' && imp.current && item(imp.current.hash)) return read(imp.current, imp.queue.length);
    if (arg === 'skip' && imp.current) {
      imp.skipped.push(imp.current.title);
      imp.current = null;
    }
    if (['go', 'next', 'skip'].includes(arg) && imp.queue.length && nextResumeId(s)) {
      const next = item(imp.queue.shift());
      if (next) return read(next, imp.queue.length);
    }
  }
}
// PDF уже разобран в «PDF text»; «➕ Как новое резюме» — отдельное резюме со своим поиском и правилами
if (job.op === 'replace' && job.value === 'add' && state.pending?.text) {
  if (!nextResumeId(s)) return [{ json: { route: 'step', problem: `уже ${MAX_RESUMES} резюме — это предел. Удали ненужное: ⚙️ → 📄 Резюме` } }];
  state.text = state.pending.text;
  return [{ json: { route: 'llm', mode: 'extract', text: state.text, create: true, inherit: s['profile.facts'] } }];
}
// Текст нового резюме — ответом на вопрос «➕ Новое резюме» (PDF-файл придёт отдельным документом)
if (job.op === 'input' && job.field === 'newresume') {
  const text = job.text.trim();
  if (!nextResumeId(s)) return [{ json: { route: 'step', problem: `уже ${MAX_RESUMES} резюме — это предел. Удали ненужное: ⚙️ → 📄 Резюме` } }];
  if (text.length < 400) {
    return [{ json: { route: 'step', problem: 'в тексте почти нет резюме (нужно от 400 знаков): пришли PDF файлом или вставь текст целиком — «➕ Новое резюме» ещё раз' } }];
  }
  state.text = text.slice(0, 30000);
  return [{ json: { route: 'llm', mode: 'extract', text: state.text, create: true, inherit: s['profile.facts'] } }];
}
if (job.op === 'input' && job.field === 'profile' && job.text.trim()) {
  // Правим черновик онбординга, а если его нет — сохранённый профиль (резюме, чью карточку открыли)
  const rs = resumeSettings(s, state.target && resumeById(s, state.target) ? state.target : 'r1');
  const draft = state.draft ?? {
    facts: rs['profile.facts'],
    about: rs['profile.about'],
    search: {
      roles: rs['search.roles'],
      in_name: rs['search.in_name'],
      anywhere: rs['search.anywhere'],
      stop_words: rs['filter.stop_words'],
      area: rs['search.area'],
    },
    rules: savedRules(rs),
  };
  return [
    {
      json: {
        route: 'llm',
        mode: 'revise',
        draft: { facts: draft.facts, about: draft.about, search: draft.search, rules: draft.rules },
        instruction: job.text.trim(),
        // Правка нового резюме до сохранения: пол, город и имя — как у основного
        ...(state.mode === 'create' && { create: true, inherit: s['profile.facts'] }),
      },
    },
  ];
}
return [{ json: { route: 'step' } }];

// Правила профессии из сохранённых llm.rules: без общих (их commonRules добавит снова при сохранении)
function savedRules(settings) {
  const r = settings['llm.rules'];
  return { skip: r.skip ?? [], maybe: r.maybe ?? [], apply: r.apply ?? [], ignore: r.ignore ?? [] };
}
