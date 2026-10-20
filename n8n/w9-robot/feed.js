// W9 · Feed — автоотклик (6.1c, 20.10.2026): кого роботу взять самому, пока очередь не заполнена.
// Нода: Code, режим «Run Once for All Items». Вход: $input — «Auto rows» (строки approved и waiting), «Queue» — очередь
// робота, «Gate» — ворота (wait, today, limit), «Settings».
// Выход: по item на действие (не больше AUTO_DEPTH в работе, лимит дня — с учётом очереди и пишущихся писем):
//   { kind: 'enqueue', op: 'enqueue', auto: true, id } — ✅ с письмом, робот её ещё не пробовал → «Run W9 enqueue»
//      (тот же Plan → Enqueue, что у 🚀: одна дорога в очередь);
//   { kind: 'claim', id } — карточка с apply нейросети → «Auto claim» (waiting → approved, если её никто не тронул) →
//      письмо W5 → W5 сам ставит его в очередь;
//   { kind: 'unclaim', id } — захват без письма дольше 10 мин (W5 упал) → «Auto unclaim»: снова ждёт решения.
// Ничего не берём, если автоотклик выключен или на паузе, робот ждёт человека (блок), не отвечает, исчерпан лимит дня
// или сейчас тихие часы; захваты без письма чиним всегда.

// @include n8n/shared/time.js

// @include n8n/shared/card.js
// @include n8n/shared/settings.js
// @include n8n/shared/resumes.js
// @include n8n/shared/robot.js
// @include n8n/shared/auto.js

const s = loadSettings($('Settings').all());
const gate = $('Gate').first().json;
const now = Date.now();
const byId = new Map();
for (const r of [...$input.all(), ...$('Queue').all()].map((i) => i.json)) if (r?.id) byId.set(r.id, { ...byId.get(r.id), ...r });
const rows = [...byId.values()];

const { letters, ready, stale } = autoCandidates(rows, s, now);
const out = stale.map((r) => ({ json: { kind: 'unclaim', id: r.id } }));

const stop = ['disabled', 'paused', 'down', 'blocked', 'limit'].includes(gate.wait);
if (!autoOn(s) || s['apply.paused'] || stop || !autoWindow(now)) return out;

const busy = autoPipeline(rows).total;
const room = Math.min(AUTO_DEPTH - busy, gate.limit - gate.today - busy);
// Сначала ✅ с готовым письмом (быстрее и без нейросети), потом карточки нейросети
for (const r of [...ready, ...letters].slice(0, Math.max(0, room))) {
  out.push({ json: r.status === 'approved' ? { kind: 'enqueue', op: 'enqueue', auto: true, id: r.id } : { kind: 'claim', id: r.id } });
}
return out;
