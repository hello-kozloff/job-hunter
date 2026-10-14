// W11 · PDF text — текст резюме из «Extract PDF»: чистка и проверка (13.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Extract PDF» ({ text, numpages }; ошибка — { error }), «Job»,
//       «Settings» (готов ли профиль), static data.
// Выход: { toLlm, text, problem } → «To LLM?»: онбординг — к нейросети; профиль уже есть — новое резюме ждёт выбора
// (pending в static data, «Step» спросит «Всё заново / Только текст»); проблема — «Step» покажет её.
// pdf.js отдаёт текст hh в правильном порядке (проверено на выгрузке hh 13.10.2026); убираем только подвалы страниц.

// @include n8n/shared/settings.js

const job = $('Job').first().json;
const s = loadSettings($('Settings').all());
const state = $getWorkflowStaticData('global');
const out = $input.first().json;

const MAX = 30000;
const raw = String(out.text ?? '');
const text = raw
  .replace(/\r/g, '')
  // Подвал каждой страницы выгрузки hh: «Резюме обновлено 10 октября 2026 в 15:18»
  .replace(/^.*Резюме обновлено \d{1,2} \S+ \d{4} в \d{1,2}:\d{2}.*$/gm, '')
  .replace(/[ \t ]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, MAX);

let problem = '';
if (out.error) problem = `PDF не открылся: ${String(out.error.message ?? out.error).slice(0, 160)}`;
else if (text.length < 400) problem = 'в PDF почти нет текста (скан или картинка?) — пришли PDF, скачанный с hh: «Мои резюме» → резюме → «Скачать» → PDF';

if (problem) return [{ json: { toLlm: false, problem } }];
if (s['profile.ready']) {
  state.pending = { text, fileName: job.file?.name ?? '' };
  return [{ json: { toLlm: false, text, replace: true } }];
}
state.text = text;
return [{ json: { toLlm: true, mode: 'extract', text } }];
