# Этап 5 — ежедневная сводка и страж

**Цель:** каждое утро короткая сводка за прошедший день сбора; если система не работает (Mac спит, Docker на паузе, n8n упал), внешний страж пишет в Telegram сам.

Решения пользователя (07.10.2026):

| Вопрос | Решение |
|---|---|
| Когда | 10:00 по Таиланду (06:00 МСК) — итог дня сбора 9–21 МСК |
| Что | воронка, хвосты, сбои, прогресс теневого режима |
| Звук | без звука; со звуком — только если есть сбои |
| Хвосты | только количество |
| Карточки без решения | через 3 дня — «⌛ устарела», кнопки убираются |
| Закрытые вакансии | раз в день хвосты проверяются на hh; закрыта — «🔒 закрыта на hh», кнопки убираются у карточки и письма |
| Страж | healthchecks.io, тревога в Telegram через их бота, если пропущен хотя бы 1 сбор |
| 50 оценок | сводка напоминает «пора разбирать», разбор делаем вместе с Claude |
| Еженедельный отчёт | не нужен |

## Сводка

```
☀️ Сводка за сутки · 08.10
🔎 Новых вакансий: 37 → фильтр отсеял 18 (> 3000 откликов 8 · Vue/Angular 6 · чёрный список 4)
🤖 Оценено: 18 — 🟢 6 · 🟡 7 · 🔴 5
👤 Твои решения: ✅ 7 · 🤔 2 · ❌ 1 · 📨 отправлено 2
⏳ Хвосты: без решения 9 · ✅ без отклика 5
⌛ Устарели: 1 · 🔒 закрылись на hh: 2
🧪 Теневой режим: 10/50, совпало 8 (80%)
⚙️ Сборов 7 из 7, ошибок нет, туннель работает      ← или «⚠️ Сбои: …» (тогда со звуком)
```

Сбои: сборов меньше 7 за сутки, ошибки запусков (по workflow), туннель не отвечает 403 снаружи, вакансии ждут оценки нейросетью, нет данных о запусках.

## Как устроено

```
W6 Summary  Schedule 0 6 * * * МСК (+ Manual) → All rows → Plan
  ├ Expire rows → Card: expired → Expired done → Save expired           (status = expired)
  ├ Check candidates → Vacancy page (hh, 3 с) → Archive status
  │     ├ Card: archived → Archived done → Save archived                 (status = archived)
  │     └ Has letter? → Letter: archived
  └ Executions (публичный API n8n) → Tunnel (https://<NGROK_DOMAIN>/ → 403) → Summary → Send summary
W1 Collector  OK? → HC ping? → HC ping (GET $env.HC_PING_URL) — сигнал стражу после успешного поиска
```

- Код: `n8n/w6-summary/*.js`; разбор страницы hh — общий с W1: `n8n/shared/hh.js`.
- Колонка `card_at` — когда W2 отправил карточку (от неё считаются 3 дня). У старых строк — `createdAt`.
- Ключ публичного API n8n — credential «n8n API» (`jobHunterN8nApi1`), права `execution:list`, `execution:read`.

## Настройка (один раз)

1. **Ключ API n8n** (делает Claude):
   ```bash
   node scripts/n8n-api.mjs api-key | docker exec -i job-hunter-n8n sh -c \
     'cat > /tmp/c.json && n8n import:credentials --input=/tmp/c.json; rm -f /tmp/c.json'
   ```
2. **healthchecks.io** (пользователь):
   - https://healthchecks.io → бесплатный аккаунт → **Add Check**: Name `job-hunter W1`; Schedule **Cron** `0 9-21/2 * * *`, Time Zone `Europe/Moscow`; Grace Time **30 минут**;
   - **Integrations → Telegram** → @HealthchecksBot → Start;
   - Ping URL → `.env`: `HC_PING_URL=https://hc-ping.com/…`.
3. Деплой: `node scripts/n8n-api.mjs migrate && scripts/deploy.sh --publish`.

## Проверка

```bash
node scripts/n8n-api.mjs run jobHunterW6Summ1          # сводка сейчас (устаревшие и закрытые — по-настоящему)
node scripts/run-code-node.mjs n8n/w6-summary/summary.js <tunnel.json> --ref 'All rows=@<rows.json>' \
  --ref 'Plan=@<plan.json>' --ref 'Executions=@<executions.json>' --env NGROK_DOMAIN=…
```

## Готово, когда

- три утра подряд приходит сводка, цифры совпадают с таблицей;
- страж прислал тревогу, когда Mac спал во время сбора (можно проверить: закрыть крышку на 3 часа днём).
