// W9 · Remind plan — 🔔 в карточке /v<id> (6.3): можно ли поставить напоминание в очередь.
// Нода: Code, режим «Run Once for All Items». Вход: «Remind row» — строка вакансии (пустой item — строки нет), «Job»,
// «Settings». Выход: { id, queryId, chatId, save: enqueue | '', toast } → «Remind save?»: enqueue — в очередь,
// иначе сразу «Remind done» с подсказкой, почему нет.

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/settings.js
// @include n8n/shared/robot.js
// @include n8n/shared/remind.js

const job = $('Job').first().json;
const s = loadSettings($('Settings').all());
const r = $input.first()?.json ?? {};
const now = Date.now();
const SKIP_TOAST = {
  sent: `🔔 Уже напоминал ${localDate(r.remind_at)} — напоминание одно`,
  already: '🔔 Напоминание уже есть в чате отклика',
  viewed: '👀 Работодатель уже открыл отклик — напоминать незачем',
  invited: '🎉 На hh — приглашение, напоминать незачем',
  rejected: '❌ На hh — отказ, напоминать незачем',
  wrote: '💬 В чате отклика уже писали — второй раз не пишу',
  closed: '🔒 В чат этого отклика писать нельзя',
  archived: '🔒 Вакансия закрыта',
  no_topic: '❓ Отклика на hh нет',
};
const out = { id: Number(r.id) || job.id, queryId: job.queryId, chatId: job.chatId, save: '', toast: '' };
if (!r.id) out.toast = '⚠️ Вакансии нет в базе';
else if (!s['apply.enabled']) out.toast = '🚀 Робот выключен — ⚙️ → 🚀 Робот';
else if (r.status !== 'applied') out.toast = 'Напомнить можно только об отправленном отклике';
else if (r.remind_state) out.toast = '⏳ Уже в очереди напоминаний';
else if (SKIP_TOAST[r.remind_result]) out.toast = SKIP_TOAST[r.remind_result];
else if (r.apply_type === 'external') out.toast = '🌐 Отклик на сайте работодателя — чата на hh нет';
else if (!remindable(r, now)) {
  out.toast = r.remind_result === 'too_early' ? '⏳ hh: отклику меньше 3 дней — попробую завтра' : `🔔 Рано: напомнить можно с ${localDate(new Date(remindFrom(r)).toISOString())}`;
} else out.save = 'enqueue';
return [{ json: out }];
