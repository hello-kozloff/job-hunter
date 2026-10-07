# Job Hunter v2 — архитектура

Утверждена пользователем 08.10.2026 (сессия Claude Code). Источник правды по устройству v2; ход работ — `v2/CLAUDE.md`.


## Context

v1 (n8n, один пользователь, одно Frontend-резюме) работает стабильно. Цель v2: любой приглашённый пользователь Telegram проходит онбординг, заводит одно или несколько резюме (Frontend, QA, …) и у каждого резюме свои поиск, фильтр, чёрный список, правила нейросети и письма. Вход — по инвайту. v1 не трогаем: v2 строится рядом и изолированно, потом данные v1 импортируются в v2 как Frontend-резюме админа.

Почему не доработка v1: в v1 владелец зашит везде — `TG_CHAT_ID` из env (`n8n/w3-telegram/route.js:25`, `scripts/build-workflows.mjs:176`), резюме файлом `docs/resume.md` (`build-prompt.js:17`, `build-letter.js:23`), фронтенд-правила в коде (`filter-search.js`: angular/no_stack/foreign; промпты W2/W5), настройки и static data общие, у строк таблиц нет владельца. Data Tables без транзакций и связей, workflow по 100–170 КБ.

### Решения пользователя (08.10.2026)
| Вопрос | Решение |
|---|---|
| Платформа | Гибрид: ядро на **Python FastAPI**, n8n — оркестратор |
| Хостинг | Сначала Mac рядом с v1, архитектура готова к VPS |
| Изоляция | Тот же репо, папка `v2/`, свой compose project, **новый бот**, своя БД, **отдельный инстанс n8n** |
| LLM | Твой ключ на всех; квоты в коде есть, на старте выключены |
| Пул вакансий | Общий пул + совпадения по резюме |
| Ввод резюме | Ссылка hh, PDF/DOCX, текст в чат |
| Настройка резюме | LLM собирает черновик, правка **текстом (LLM → правило → предпросмотр) + кнопками** |
| Инвайты | Одноразовая ссылка от админа + «запросить доступ» |
| Миграция | v1 работает; v2 первым получает QA-резюме; потом импорт v1 → Frontend-профиль, v1 на паузу |
| Лимиты | Без лимитов (код под них есть) |
| Приватность | Не на старте (но контакты из резюме в LLM не шлём — дёшево) |
| MVP v2 | Паритет с v1: онбординг + резюме + сбор + фильтр, оценка + карточки + теневой режим, письма, меню/статистика/сводка |
| TZ/язык | Свой TZ у пользователя, тексты RU через словарь |
| Транспорт бота | Long polling (ngrok-домен занят v1) |
| ЧС | Только на уровне резюме |
| Пересечение резюме | Одна карточка, оценки всех подходящих резюме, ✅ спрашивает «с каким резюме» |
| Теневой режим | Переключатель на резюме, вручную |
| Админ | Инвайты/заявки, пользователи, здоровье, рассылка |
| hh-нагрузка | Глобальный регулятор |
| Аудитория | Ты + 2–10 друзей |

## Архитектура

### Граница гибрида
**n8n решает «когда и в каком порядке», ядро — «что и как».**
- **n8n v2** (отдельный контейнер, `127.0.0.1:5679`, своя БД в общем Postgres): расписание, все HTTP-запросы к hh (один поток, паузы, видно в UI, легко подменить на прокси), последовательность шагов, повторы, Error Trigger. Telegram-креденшелов и бизнес-логики нет.
- **Ядро (Python)**: Postgres, вся логика (разбор hh, фильтр, промпты, LLM, квоты), бот, онбординг, админка. n8n зовёт его по внутреннему REST с заголовком `X-Internal-Token`.
- Разовые действия пользователя (письмо по ✅, правка правил, пробный сбор) — ядро само (asyncio-задача + блокировка в БД); «🔄 Собрать сейчас» → ядро дёргает webhook n8n v2 (localhost, секрет).

### Контейнеры (`v2/docker-compose.yml`, `name: job-hunter-v2`)
- `postgres` (16, только внутренняя сеть, том) — БД `hunter` (ядро) + БД `n8n` (n8n v2);
- `api` — FastAPI (uvicorn), `127.0.0.1:8100` для отладки;
- `bot` — aiogram 3, long polling (тот же образ, другой entrypoint);
- `n8n` — n8n 2.42.3, `127.0.0.1:5679`, `DB_TYPE=postgresdb`.
Проект compose другой → `docker compose` v1 (`scripts/deploy.sh:68,83`) его не видит и не перезапускает.

### Стек ядра
Python 3.12, uv, FastAPI, SQLAlchemy 2 (async) + asyncpg, Alembic, pydantic v2 + pydantic-settings, aiogram 3, httpx, selectolax (HTML), pypdf + python-docx, google-genai + anthropic SDK, pytest + testcontainers (Postgres). Слои: `domain` (чистая логика, без I/O) → `services` → `repos` (каждый запрос ограничен `user_id`) → `api` / `bot`.

### Модель данных (Postgres)
Глобальное (общий пул):
- `vacancies` — одна строка на вакансию источника: `source, external_id` (unique), `dup_key`, поля выдачи и страницы v1 (схема `n8n/schema.mjs`), `description`, `page_fetched_at`, `archived_at`;
- `searches` — уникальные поисковые URL (hash), `last_run_at`, `next_due_at`; `profile_searches` (M:N);
- `fetch_log` — каждый запрос к hh (для бюджета и здоровья);
- `runs` — сборы.
Пользователь:
- `users` — `tg_id`, `role` (admin|user), `status` (active|blocked), `tz`, `invited_by`, `limits` jsonb (пусто = без лимитов);
- `invites` — `code`, `max_uses`, `used`, `expires_at`, `revoked`; `access_requests`;
- `profiles` (резюме) — `user_id`, `title`, `emoji`, `status` (draft|active|paused), `shadow`, `active_config_id`;
- `resumes` — `profile_id`, `source` (hh|file|text), `raw_text`, `structured` jsonb (навыки: коммерческие/пет; опыт; без контактов);
- `profile_configs` — версии настроек (`version`, `config` jsonb, `created_by` llm|user, `comment`). Аналог `prompt_v` v1: каждая оценка ссылается на версию;
- `blacklist` — `profile_id, company, company_id`;
- `matches` — `profile_id, vacancy_id` (unique): `filter_status` (passed|rejected), `reasons`, `decision`, `llm_reason`, `llm_model`, `config_id`;
- `user_vacancies` — карточка пользователя: `user_id, vacancy_id` (unique), `status` (как в v1: waiting → approved/maybe/skipped → applied, expired, archived), `my_decision`, `my_reason`, `chosen_profile_id`, `letter`, `letter_notes`, `letter_lock`, `tg_card_id`, `tg_letter_id`, `card_at`, `applied_at`;
- `llm_usage` — `user_id, kind` (score|letter|draft|rule), токены, день (квоты и «расход по пользователям»);
- `alerts` — как в v1 W4 (ключ, hits, is_open), адресат — админ.

### Конфиг резюме (`ProfileConfig`, pydantic, jsonb)
- `search`: `anywhere[]`, `in_name[]`, `professional_roles[]` (96 — разработчик, 124 — тестировщик…), `work_format`, `education`, `experience[]`, `period`, `areas[]`;
- `filter`: `max_responses`, `rules[]` — маленький DSL: `{id, label, stage: search|page, enabled, when: Cond, reason}`, `Cond` = `{field: title|skills|description|experience, any|all|none: [паттерны «*»]}` + `and/or/not`. Им выражаются все правила v1, включая исключения («нет React/Vue, кроме AI-вакансий с JS/TS»). «В архиве» и «только из РФ» — встроенные флаги;
- `llm`: `apply[]`, `maybe[]`, `skip[]` (текстом), `cases[]` (как `llm.cases` v1), `provider`;
- `letter`: `samples[]`, `signature`, `contact`, `notes[]`;
- `schedule`: `day_every`, `night_every`, `day_window` (по TZ пользователя), `paused`.

### Поток данных
1. **Сбор** (n8n `V2 Clock`, каждые 5 мин): `POST /internal/collect/plan` → ядро отдаёт поиски, у которых `next_due_at` прошёл, с учётом глобального бюджета (один поток, 3–8 с между запросами, суточный потолок, растягивание интервалов при нехватке) → n8n: GET hh → `POST /internal/collect/search` (HTML) → ядро: разбор InitialState, детектор блока (порт v1), склейка дублей, upsert в пул, `matches` по фильтру выдачи для каждого профиля → ответ: какие страницы вакансий нужны (только новые для пула) → n8n грузит → `POST /internal/collect/vacancy` → фильтр страницы. Капча → ядро ставит глобальный стоп сбора + тревога админу.
2. **Оценка** (`V2 Clock` после сбора): цикл `POST /internal/score/batch` пока `remaining > 0`. Ядро: захват `matches` (UPDATE … RETURNING, как Claim v1), промпт = общий шаблон (порт `n8n/w2-score/build-prompt.js`) + `llm` конфига + структурированное резюме → LLM → `decision`. Когда у вакансии оценены все прошедшие фильтр профили пользователя → одна карточка в `user_vacancies` (строки «🎨 Frontend: maybe · 🧪 QA: apply»; skip-профили с выключенным теневым режимом — только в сводке).
3. **Кнопки** (бот): ✅/🤔/❌/«📨 Уже откликался»/«🚫 В ЧС» (если резюме >1 — выбор резюме); расхождение → «Почему?»; ✅ → письмо выбранного резюме (порт `build-letter.js` + `parse-letter.js`), «🔄», правка ответом, «📨 Отправил»/«↩️ Отменить». Любой callback проверяет: `from.id` — владелец строки.
4. **Ежедневное** (n8n `V2 Daily`, раз в час): `/internal/summary/due` — сводки тем, у кого в их TZ 09:00; `/internal/expire`; перепроверка закрытых на hh (план → n8n грузит → ядро). Чистка описаний и `runs` как в v1.
5. **Ошибки**: n8n Error Trigger → `/internal/alert`; ядро само ловит исключения (бот, API) → те же `alerts` → админу.

### Онбординг (бот)
`/start <код>` → проверка инвайта (без кода: «доступ по приглашению» + «Запросить доступ» → заявка админу с кнопками) → TZ (кнопки популярных + ввод) → «Добавить резюме»: ссылка hh / файл / текст → извлечение текста → LLM: `structured` резюме (контакты вырезаются) + черновик `ProfileConfig` (роль hh, слова, правила, apply/maybe/skip) → экран профиля: что ищем, что режем, как оценивает → «🧪 Пробный сбор»: 1 поиск + прогон фильтра и оценки по ≤10 вакансиям, отчёт «прошло/отсеяно и почему» без карточек → «Запустить». Правка: текст «не брать Selenium без Playwright» → LLM → новое правило → предпросмотр по последним 50 вакансиям из пула → подтвердить → новая версия конфига. Кнопки — вкл/выкл правил, слова, теневой режим, пауза, ЧС.

### Админка (`/admin`, `role=admin`, первый админ — `ADMIN_TG_ID` из `.env`)
Инвайты (создать: число активаций, срок; отозвать), заявки, пользователи (список, блок, лимиты, резюме/оценки), здоровье (запросы к hh за сутки, стоп сбора, тревоги, LLM-расход по пользователям, 429), рассылка (текст → всем активным, с паузами).

## Структура `v2/`
```
v2/docker-compose.yml, .env.example, Dockerfile, pyproject.toml, alembic.ini
v2/app/config.py                       pydantic-settings
v2/app/db/{models.py, session.py}      SQLAlchemy; alembic/versions/
v2/app/domain/hh/{search.py, vacancy.py, block.py, dedup.py}   порт n8n/shared/hh.js, parse-search.js, parse-vacancy.js
v2/app/domain/filter/{dsl.py, engine.py, presets.py}           DSL правил; пресет Frontend = правила v1
v2/app/domain/llm/{providers.py, score.py, letter.py, draft.py, rule_edit.py}
v2/app/domain/schedule.py              порт n8n/shared/schedule.js, с TZ пользователя
v2/app/services/*                      collect, score, cards, letters, onboarding, admin, summary, import_v1
v2/app/api/internal.py                 эндпоинты для n8n
v2/app/bot/{main.py, routers/*, texts.py, keyboards.py}       texts.py — все строки RU (словарь под i18n)
v2/n8n/workflows/*.json + v2/scripts/build-workflows.mjs       маленькие: V2 Clock, V2 Daily, V2 Collect now, V2 Errors
v2/scripts/deploy.sh                   compose up + alembic upgrade + импорт/публикация n8n v2
v2/scripts/import_v1.py                Data Tables v1 → Frontend-профиль админа
v2/tests/                              фикстуры hh из fixtures/ (те же файлы), изоляция пользователей
docs/v2/architecture.md, docs/v2/stages/*.md
```
Переиспользуем (порт в Python, логика 1:1, проверка на тех же фикстурах): `n8n/shared/hh.js`, `n8n/w1-collector/parse-search.js`, `filter-search.js`, `parse-vacancy.js`, `n8n/shared/ai.js`, `n8n/shared/search.js`, `n8n/shared/schedule.js`, `n8n/w2-score/build-prompt.js` + `parse-verdict.js`, `n8n/w5-letter/build-letter.js` + `parse-letter.js`, `n8n/shared/card.js`, `n8n/w6-summary/summary.js`, тексты меню из `docs/bot-menu.md`.

## Этапы (каждый — `feature/v2-*` от `develop`, PR, деплой v2, проверка; v1 не затрагивается)
| Этап | Что | Готово, когда |
|---|---|---|
| v2.0 Каркас | `v2/` compose, Postgres, api/bot/n8n, Alembic со всей схемой, `/health`, CI-тесты (pytest), deploy v2, новый бот в BotFather | `v2/scripts/deploy.sh` поднимает всё; v1 работает без простоя |
| v2.1 Доступ | инвайты, заявки, онбординг до TZ, `/admin`: инвайты/пользователи/рассылка, тексты в `texts.py` | друг заходит по ссылке, без ссылки — заявка |
| v2.2 Резюме | ввод 3 способами (проверить: видна ли публичная ссылка hh без входа), structured, LLM-черновик конфига, DSL + движок, правка текстом/кнопками, версии конфига | QA-резюме заведено и настроено в боте |
| v2.3 Сбор | порт разбора hh + детектор блока, пул, глобальный регулятор, `V2 Clock`, matches + фильтр, пробный сбор, «Собрать сейчас» | QA-вакансии копятся, отсев с причинами |
| v2.4 Оценка | порт промпта/разбора, одна карточка на несколько резюме, кнопки, «Почему?», ЧС, теневой режим, проверка владельца в callback | карточки QA приходят, кнопки работают |
| v2.5 Письма | порт W5, образцы/подпись на резюме, выбор резюме при ✅ | письмо по ✅ как в v1 |
| v2.6 Сервис | меню/вкладки/статистика, утренняя сводка по TZ, устаревшие/закрытые, тревоги, здоровье в `/admin`, чистка | паритет с v1 |
| v2.7 Переезд | `import_v1.py`: пресет Frontend = правила v1, резюме, ЧС, вакансии/решения/письма; проверка; v1 на паузу (`--paused`), не удалять | Frontend живёт в v2 |
| Потом | квоты включить, VPS + webhook, Mini App для правил, новые источники (адаптер `source`), автоотклик | — |

Git: scope `v2`, `v2-bot`, `v2-api`, `v2-n8n`, `v2-db`; правила `docs/git-flow.md` без изменений. CLAUDE.md: добавить раздел про v2 (или отдельный `v2/CLAUDE.md`).

## Риски
- **hh-бан IP** — общий регулятор на v2; v1 тоже бьёт с этого IP (~29+N запросов/сутки) — учесть в потолке. Капча → стоп всего сбора v2.
- **Утечка между пользователями** — `user_id` в каждом репозитории, проверка владельца в каждом callback, тест «пользователь B не видит/не жмёт строки A».
- **Публичное резюме hh** может быть не видно без входа → тогда только файл/текст.
- **Gemini free** — общий лимит запросов на всех пользователей; при 429 — переключение провайдера (как в v1) и тревога.
- **Mac спит** — как в v1; v2 догоняет через `search_period` и `next_due_at`.

## Verification
- `cd v2 && uv run pytest` — разбор hh на `fixtures/search-p0.html`, `vacancy.html`, `synthetic-captcha.html` (результат совпадает с `scripts/run-code-node.mjs` v1 на тех же файлах); DSL: пресет Frontend даёт те же отсевы, что `filter-search.js`/`parse-vacancy.js` на фикстурах; изоляция пользователей; Alembic upgrade/downgrade в testcontainers.
- После каждого деплоя v2: `docker compose -p job-hunter ps` — v1 жив, `node scripts/n8n-api.mjs run jobHunterW8Clock` v1 без ошибок.
- Живая проверка: второй Telegram-аккаунт (или друг) — инвайт → онбординг → резюме → пробный сбор → карточка → ✅ → письмо; без инвайта — заявка; чужой callback_data — отказ.
- n8n v2 UI (`localhost:5679`): запуски `V2 Clock`, число запросов к hh в `fetch_log` не превышает потолок.
