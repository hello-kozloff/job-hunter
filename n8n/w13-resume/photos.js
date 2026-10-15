// W13 · Photos — снимки робота для Telegram (сухой прогон выгрузки на hh, часть D): item на снимок { shot, caption }.
// Нода: Code, режим «Run Once for All Items». Вход: «Step» { photos }. Пусто — дальше ничего не идёт.

return ($('Step').first().json.photos ?? []).slice(0, 10).map((p) => ({ json: { shot: p.shot, caption: p.caption } }));
