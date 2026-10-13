// W11 · Collect job — онбординг закончен: сразу первый сбор (W1, без ожидания, kind = bot).
// Нода: Code, режим «Run Once for All Items». Ветка ниже «Save profile» (execution order v1) — W1 читает уже новый профиль.

return $('Step').first().json.collect ? [{ json: { kind: 'bot' } }] : [];
