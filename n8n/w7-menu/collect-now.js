// W7 · Collect now — «🔄 Собрать сейчас» в ⚙️ Настройках → W1 (без ожидания), kind = bot (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Идёт ли уже сбор — проверит сам W1 (журнал runs).
// Выход: [{ kind: 'bot' }] → «Run W1» или [] — кнопку не нажимали или профиля ещё нет (резюме не прислали).

// @include n8n/shared/settings.js

const ready = loadSettings($('Settings').all())['profile.ready'];
return $('Job').first().json.collectNow && ready ? [{ json: { kind: 'bot' } }] : [];
