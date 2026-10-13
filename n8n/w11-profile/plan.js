// W11 · Plan — какой путь: скачать PDF, спросить нейросеть или просто шаг онбординга (13.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Job», «Settings», static data (черновик онбординга).
// Выход: { route: pdf | llm | step, mode: extract | revise, text, draft, instruction }:
//   pdf  — документ PDF: скачать и достать текст («PDF text» решит, нужна ли нейросеть);
//   llm  — «🔄 Всё заново» по новому резюме (extract, текст из static data) или «✏️ Поправить» (revise, пожелание);
//   step — остальное: кнопки шагов, вопросы, сохранение («Step»).
// Static data (global): draft — черновик профиля, text — текст резюме, pending — новое резюме, step, mode, panelId.

// @include n8n/shared/settings.js

const job = $('Job').first().json;
const s = loadSettings($('Settings').all());
const state = $getWorkflowStaticData('global');

// Выгрузка резюме с hh весит сотни КБ; Telegram отдаёт ботам файлы до 20 МБ
if (job.op === 'pdf' && job.file?.size > 5 * 1024 * 1024) {
  return [{ json: { route: 'step', problem: 'PDF больше 5 МБ — пришли выгрузку резюме с hh: «Мои резюме» → резюме → «Скачать» → PDF' } }];
}
if (job.op === 'pdf') return [{ json: { route: 'pdf' } }];
if (job.op === 'replace' && job.value === 'all' && state.pending?.text) {
  return [{ json: { route: 'llm', mode: 'extract', text: state.pending.text } }];
}
if (job.op === 'input' && job.field === 'profile' && job.text.trim()) {
  // Правим черновик онбординга, а если его нет — сохранённый профиль
  const draft = state.draft ?? {
    facts: s['profile.facts'],
    about: s['profile.about'],
    search: {
      roles: s['search.roles'],
      in_name: s['search.in_name'],
      anywhere: s['search.anywhere'],
      stop_words: s['filter.stop_words'],
      area: s['search.area'],
    },
    rules: savedRules(s),
  };
  return [{ json: { route: 'llm', mode: 'revise', draft: { facts: draft.facts, about: draft.about, search: draft.search, rules: draft.rules }, instruction: job.text.trim() } }];
}
return [{ json: { route: 'step' } }];

// Правила профессии из сохранённых llm.rules: без общих (их commonRules добавит снова при сохранении)
function savedRules(settings) {
  const r = settings['llm.rules'];
  return { skip: r.skip ?? [], maybe: r.maybe ?? [], apply: r.apply ?? [], ignore: r.ignore ?? [] };
}
