# Job Hunter v2 — контекст для Claude Code

Многопользовательская версия: много пользователей Telegram (вход по инвайту), у каждого несколько резюме (профилей) со своими поиском, фильтром, чёрным списком, правилами нейросети и письмами. Архитектура и все решения пользователя — `docs/v2/architecture.md`. v1 (n8n, корень репозитория, корневой `CLAUDE.md`) работает параллельно и **не должна страдать**.

## Правила

- **v1 не трогать.** Всё v2 — в `v2/` и `docs/v2/`. Свой compose project `job-hunter-v2`, свой бот (не токен v1), своя база, свой n8n на `127.0.0.1:5679`. После каждого деплоя v2 проверять, что `job-hunter-n8n` v1 жив и не перезапускался.
- Ядро — Python 3.12 + FastAPI (решение пользователя). Локально Python/uv нет и не ставим: всё в Docker.
- Граница гибрида: **n8n v2 решает «когда и в каком порядке»** (расписание, запросы к hh, повторы, Error Trigger), **ядро — «что и как»** (данные, логика, LLM, бот). У n8n v2 нет Telegram-креденшелов.
- Изоляция пользователей: любой запрос к пользовательским таблицам ограничен `user_id`/`profile_id` владельца; каждый callback бота проверяет, что `from.id` — владелец строки. На каждую такую фичу — тест «B не видит и не жмёт строки A».
- Тексты бота — только в `app/bot/texts.py` (RU-словарь, потом i18n).
- Git — как у v1 (`docs/git-flow.md`): `feature/v2-*` от `develop`, коммиты по-английски, scope `v2`, `v2-bot`, `v2-api`, `v2-n8n`, `v2-db`.

## Команды

```bash
v2/scripts/test.sh                 # pytest в контейнере против базы hunter_test
v2/scripts/deploy.sh               # build → postgres → alembic upgrade head → api, bot, n8n (с develop/production)
cd v2 && docker compose run --rm --no-deps -v "$PWD/alembic:/app/alembic" api \
  alembic revision --autogenerate -m "<что>"   # новая миграция после правки app/db/models.py
curl localhost:8100/health
```

- Autogenerate кладёт ключи с `use_alter=True` (циклы `users ↔ invites`, `profiles ↔ profile_configs`) внутрь `create_table` → такие ключи переносить в `op.create_foreign_key` в конце `upgrade` (см. первую миграцию).
- `INSERT … RETURNING` через ORM отдаёт объект из identity map со старыми полями → `.execution_options(populate_existing=True)`.
- `tests/test_migrations.py` падает, если модели разошлись с миграциями.

## Окружение

- `v2/.env` (права 600, не в git; шаблон `v2/.env.example`): пароли Postgres/n8n, `N8N_ENCRYPTION_KEY`, `INTERNAL_TOKEN` (n8n → ядро), `TG_BOT_TOKEN` (новый бот), `ADMIN_TG_ID` (= `TG_CHAT_ID` v1), `GEMINI_API_KEY`.
- Порты: api `127.0.0.1:8100`, n8n v2 `127.0.0.1:5679`; Postgres наружу не открыт. Базы: `hunter` (ядро), `n8n` (n8n v2), `hunter_test` (тесты).
- Бот — long polling; без `TG_BOT_TOKEN` контейнер ждёт, не падает.

## Ход работ

| Этап | Статус |
|---|---|
| v2.0 Каркас | ✅ 08.10.2026: compose (postgres, api, bot, n8n v2), вся схема БД (17 таблиц, `app/db/models.py`), Alembic, `/health`, `/internal/*` с токеном, `/start` (админ из `.env`, остальным «по приглашениям»), тесты 6/6, деплой. v1 не перезапускался. **Ждёт от пользователя:** новый бот в @BotFather → `TG_BOT_TOKEN` в `v2/.env` → деплой |
| v2.1 Доступ | ← следующий: инвайты, заявки, онбординг до TZ, `/admin` (инвайты, пользователи, рассылка) |
| v2.2 Резюме … v2.7 Переезд | см. `docs/v2/architecture.md` → «Этапы» |
