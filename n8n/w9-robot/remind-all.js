// W9 · Remind all — «🔔 Напомнить всем» на панели (6.3): кандидаты в очередь напоминаний, свежие отклики первыми.
// Нода: Code, режим «Run Once for All Items». Вход: «Remind rows» — отправленные отклики (status = applied), «Settings».
// Выход: по item на кандидата { id } → «Remind enqueue»; кандидатов нет — [{ id: 0 }], робот выключен — [{ id: 0, off }]
// (запись ничего не обновит, «Remind done» объяснит)

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/settings.js
// @include n8n/shared/robot.js
// @include n8n/shared/remind.js

const s = loadSettings($('Settings').all());
if (!s['apply.enabled']) return [{ json: { id: 0, off: true } }];
const rows = $input
  .all()
  .map((i) => i.json)
  .filter((r) => r.id);
const list = remindCandidates(rows, Date.now());
return list.length ? list.map((r) => ({ json: { id: r.id } })) : [{ json: { id: 0 } }];
