// W1 · Start — блокировка параллельных сборов и запись о начале сбора в журнал runs (07.10.2026).
// Нода: Code, режим «Run Once for All Items».
// Вход: «Busy» — строки runs со status = running (Always Output Data: пустой item, если их нет).
// Выход: [] — другой сбор ещё идёт (запись моложе 10 мин): два сбора параллельно записали бы одни и те же
//        вакансии дважды — «Is new» и «Insert» не атомарны;
//        иначе одна строка журнала → «Start run» (Insert). Запись старше 10 мин — сбор упал не дойдя
//        до «Finish run»: блокировкой не считается.

const STALE = 10 * 60 * 1000;
const now = Date.now();
const busy = $input
  .all()
  .map((i) => i.json)
  .filter((r) => r.id && now - (Date.parse(r.started_at) || 0) < STALE);
if (busy.length) return [];

// Кто запустил: расписание или вручную (у нерабочего триггера данных нет — $() бросает ошибку)
let kind = 'manual';
try {
  $('Schedule').first();
  kind = 'schedule';
} catch {
  // запуск не по расписанию
}

return [{ json: { started_at: new Date(now).toISOString(), kind, status: 'running' } }];
