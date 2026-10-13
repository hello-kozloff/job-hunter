// W4 · Alert plan — новая тревога или повтор открытой (07.10.2026: при блоке hh тревога приходила на каждом сборе).
// Нода: Code, режим «Run Once for All Items».
// Вход: «Format error» { text, key, workflow, message }; $input — «Find alert»: открытая тревога с тем же ключом
//       (Always Output Data: пустой item, если её нет или таблица не ответила).
// Выход: { repeat: false, … } — новая тревога: «Send alert» со звуком → «Save alert»;
//        { repeat: true, id, tg_message_id, hits, text } — повтор: «Edit alert» правит ту же тревогу (без звука)
//        → «Save repeat». Открытой считается тревога, которая повторялась последние 6 ч; закрывает её и
//        успешный запуск того же workflow (W1, W2: «✅ снова работает»).

// @include n8n/shared/time.js

const HOLD = 6 * 3600 * 1000;
const f = $('Format error').first().json;
const nowMs = Date.now();
const now = new Date(nowMs).toISOString();
const open = $input
  .all()
  .map((i) => i.json)
  .find((r) => r.id && r.is_open && r.tg_message_id && nowMs - (Date.parse(r.last_at) || 0) < HOLD);

if (!open) return [{ json: { repeat: false, text: f.text, key: f.key, workflow: f.workflow, message: f.message, now } }];

const hits = (open.hits || 1) + 1;
return [
  {
    json: {
      repeat: true,
      id: open.id,
      tg_message_id: open.tg_message_id,
      hits,
      now,
      text: `${f.text}\n\n🔁 Повторяется: ×${hits}, с ${localTime(open.first_at)} до ${localTime(now)} по местному`,
    },
  },
];
