// W11 · Render — панель профиля для Telegram-нод: номер выхода «Layout» и поля сообщения (13.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Step» { view: { layout, text, b, messageId } }.
// Выход: { route, text, b, chatId, messageId } или [] — показывать нечего (только вопрос или сохранение).
// Порядок раскладок = PROFILE_LAYOUTS в scripts/build-workflows.mjs: выход 2·i — новое сообщение, 2·i + 1 — правка.

const LAYOUTS = [
  'pf summary', 'pf gender', 'pf signature', 'pf contact', 'pf tz', 'pf review', 'pf replace', 'pf replace text', 'pf profile', 'pf plain',
  'rm list1', 'rm list2', 'rm list3', 'rm list4', 'rm list5', 'rm card', 'rm delete', 'rm wait',
];
const step = $('Step').first().json;
const job = $('Job').first().json;
const v = step.view;
if (!v) return [];
const i = LAYOUTS.indexOf(v.layout);
if (i < 0) throw new Error(`W11: неизвестная раскладка ${v.layout}`);
return [{ json: { route: i * 2 + (v.messageId ? 1 : 0), layout: v.layout, text: v.text, b: v.b ?? {}, chatId: job.chatId, messageId: v.messageId } }];
