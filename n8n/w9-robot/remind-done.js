// W9 · Remind done — итог нажатия на панели 🔔 или в карточке (6.3) после записи с условием: что поставлено в очередь
// или снято, подсказка на нажатие, обработать ли очередь сразу, перерисовать панель.
// Нода: Code, режим «Run Once for All Items». Вход: строки, которые обновила запись («Remind enqueue» — remind_state
// = queued, «Remind unqueue» — remind_result = stopped; пустой item — ничего не обновила) или план нажатия («Remind
// plan», когда ставить нечего); «Job», «Settings».
// Выход: { queryId, chatId, toast, tick, sync } → «Answer?», «Tick?», «Remind sync»

// @include n8n/shared/settings.js

const job = $('Job').first().json;
const s = loadSettings($('Settings').all());
const items = $input.all().map((i) => i.json);
const queued = items.filter((r) => r.id && r.remind_state === 'queued').length;
const stopped = items.filter((r) => r.id && r.remind_result === 'stopped').length;
let toast = '';
if (job.op === 'remind') {
  const plan = $('Remind plan').first().json;
  toast = !plan.save ? plan.toast : queued ? '🔔 В очереди — робот напомнит, когда не будет откликов' : '⏳ Уже в очереди напоминаний';
} else if (job.op === 'remindall') {
  const off = $('Remind all').first().json.off;
  toast = off
    ? '🚀 Робот выключен — ⚙️ → 🚀 Робот'
    : queued
      ? `🔔 В очереди ${queued} — робот напомнит не больше ${s['remind.daily_limit']} в день, отклики первыми`
      : '🔔 Некому напоминать: нет отправленных откликов старше 3 дней без итога';
} else if (job.op === 'remindstop') {
  toast = stopped ? `⏹ Убрал из очереди напоминаний: ${stopped}` : '⏹ Очередь напоминаний и так пуста';
}
return [
  {
    json: {
      queryId: job.queryId,
      chatId: job.chatId,
      toast,
      tick: queued > 0,
      sync: { action: 'panel', view: 'sync', id: job.id || 0, chatId: job.chatId, tab: '', page: 1, queryId: '', messageId: 0, userMessageId: 0 },
    },
  },
];
