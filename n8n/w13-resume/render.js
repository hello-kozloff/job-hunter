// W13 · Render — панель рекомендаций для Telegram-нод: номер выхода «Layout» и поля сообщения (15.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Step» { view: { layout, text, b, messageId } }.
// Выход: { route, text, b, chatId, messageId } или [] — показывать нечего (только вопрос, сохранение или удаление).
// Порядок раскладок = RESUME_LAYOUTS в scripts/build-workflows.mjs: выход 2·i — новое сообщение, 2·i + 1 — правка.

const LAYOUTS = ['rs root', 'ru plan', 'rq one2', 'rq one3', 'rq one4', 'rq many8', 'rq text', 'rp add', 'rp replace', 'rs done', 'rs undo', 'rs back', 'rs retry', 'rs report'];
const step = $('Step').first().json;
const job = $('Job').first().json;
const v = step.view;
if (!v) return [];
const i = LAYOUTS.indexOf(v.layout);
if (i < 0) throw new Error(`W13: неизвестная раскладка ${v.layout}`);
return [{ json: { route: i * 2 + (v.messageId ? 1 : 0), layout: v.layout, text: v.text, b: v.b ?? {}, chatId: job.chatId, messageId: v.messageId } }];
