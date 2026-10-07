# Этап 1 — сборщик W1 и тревоги W4

> **Статус (06.10.2026, 18:27 МСК): W1 и W4 работают по расписанию.**
> Всё собрано из кода и залито скриптом `scripts/deploy.sh --publish`. Проверено:
> - бэкфилл — 136 вакансий со статусом `seen`;
> - ветка поломки — HTML в `fixtures/` + ошибка с причиной;
> - Telegram — тестовое сообщение из S1;
> - цепочка «W1 упал по расписанию → W4 → тревога в Telegram».
>
> Ниже — устройство W1/W4 и ручная сборка (для понимания). Менять workflow — через код в `n8n/` и `scripts/build-workflows.mjs`, не в UI: следующий `deploy.sh` перезапишет ручные правки.

**Цель:** по расписанию (с 07.10.2026: днём 07:00–17:30 МСК каждые 30 минут, ночью каждые 2 часа) W1 забирает свежие вакансии с hh, записывает новые в таблицу и шлёт их списком в Telegram. Если hh заблокировал или сменил вёрстку — тревога в Telegram, а HTML страницы сохраняется в `fixtures/` для починки парсера.
**Время:** 1–1,5 часа.
**Перед этим:** [этап 0](stage-0.md) пройден.

Порядок: Telegram → таблица → W4 (тревоги) → W1 (сборщик) → тесты → Publish.

---

## 1. Telegram

1. **Credential.** Overview → вкладка **Credentials** → *Create Credential* → **Telegram API** → Access Token = токен бота → Save. n8n сразу проверит токен.
2. **chat_id.** Напиши своему боту в Telegram любое сообщение, например `/start`. Открой в браузере `https://api.telegram.org/bot<ТОКЕН>/getUpdates` и найди `"chat":{"id":123456789,…}` — это chat_id.
   - Пустой `result` → напиши боту ещё раз и обнови страницу.
   - Ошибка `Conflict: can't use getUpdates method while webhook is active` → открой `https://api.telegram.org/bot<ТОКЕН>/deleteWebhook`, потом снова getUpdates.
   - Ссылку с токеном никому не отправляй: по ней можно управлять ботом.
3. `.env` → `TG_CHAT_ID=123456789` → `docker compose up -d`. Контейнер пересоздастся с новой переменной, данные n8n сохранятся. Проверка: `docker exec job-hunter-n8n printenv TG_CHAT_ID`.
4. **Проверка отправки.** В любом workflow добавь ноду **Telegram** → *Send a text message*:
   - Credential — твой;
   - Chat ID → Expression: `{{ $env.TG_CHAT_ID }}`;
   - Text: `тест`.

   *Execute step* → сообщение пришло → ноду удали.

## 2. Таблица `vacancies`

Overview → **Data tables** → *Create data table* → имя `vacancies`. Добавь колонки (*Add column*). Имена — буква в букву как в таблице ниже: Insert сопоставляет поля из кода с колонками по имени.

| Колонка | Тип | Что хранит |
|---|---|---|
| `source` | string | `hh` |
| `external_id` | string | id вакансии на hh |
| `dup_key` | string | ключ склейки дублей: компания + название |
| `title` | string | название |
| `company` | string | компания |
| `company_id` | string | id компании на hh |
| `areas` | string | регионы через запятую (у склеенных дублей — все) |
| `salary_from` | number | |
| `salary_to` | number | |
| `currency` | string | `RUR`, `USD`, `KZT`… |
| `salary_gross` | boolean | `true` = до вычета налогов |
| `experience` | string | `noExperience` / `between1And3` / `between3And6` / `moreThan6` |
| `employment_form` | string | `FULL` / `PART` / `PROJECT`… |
| `work_formats` | string | `REMOTE,HYBRID`… |
| `languages` | string | например `eng:b2` |
| `key_skills` | string | навыки из выдачи (полные — на этапе 2) |
| `has_test` | boolean | работодатель прикрепил тест |
| `letter_required` | boolean | сопроводительное обязательно |
| `responses` | number | откликов всего |
| `snippet` | string | куски требований, обязанностей, условий |
| `url` | string | страница вакансии |
| `apply_url` | string | ссылка «откликнуться» |
| `apply_type` | string | `hh` (внешние отклики — этап 2) |
| `published_at` | string | дата публикации или поднятия, ISO |
| `status` | string | `seen` / `new` (дальше — по схеме из CLAUDE.md §6) |

Колонки `id`, `createdAt`, `updatedAt` n8n добавляет сам.

## 3. W4 Errors — тревоги

Новый workflow `W4 Errors`:

```
Error Trigger → Telegram
```

- **Error Trigger** — настроек нет.
- **Telegram** → *Send a text message*:
  - Chat ID: `{{ $env.TG_CHAT_ID }}`.
  - Text (Expression):
    ```
    ❗️ {{ $json.workflow.name }}: ошибка
    Нода: {{ $json.execution.lastNodeExecuted }}
    {{ $json.execution.error.message }}
    {{ $json.execution.url }}
    ```
  - Additional Fields → *Append n8n Attribution*: off.
  - Parse Mode не включай: в текстах ошибок бывают `<` и `>`, HTML-режим Telegram на них падает.
- Save → **Publish**. В n8n 2.42 неопубликованный Error workflow не запускается (в логе: «is not active and cannot be executed»), хотя документация пишет обратное.

**Проверка W4.** Ручной запуск тревогу не вызовет: Error Trigger срабатывает только на автоматических запусках. Поэтому:

1. Новый workflow `W4 test`: **Schedule Trigger** (Trigger Interval: Minutes, 1) → **Stop and Error** (Error Message: `тест тревоги`).
2. ⋯ → **Settings** → Error Workflow: `W4 Errors` → Save.
3. **Publish** → в течение минуты придёт «❗️ W4 test: ошибка … тест тревоги».
4. Unpublish и удали `W4 test`.

## 4. W1 Collector — сборщик

Новый workflow `W1 Collector`. Схема:

```
Schedule ─┐
Manual ───┴→ Any row → Plan → Search hh → Parse search → OK?
   OK? true  → Split vacancies → Is new → Insert → Format message → Telegram
   OK? false → To file → Save fixture → Stop
```

### 4.1 Schedule и Manual

- **Schedule Trigger** → имя `Schedule` → два правила Trigger Interval: *Custom (Cron)*:
  - `0,30 7-17 * * *` — днём каждые 30 минут: 07:00–17:30 МСК = 11:00–21:30 по Таиланду;
  - `0 0,2,4,6,18,20,22 * * *` — ночью каждые 2 часа: 18, 20, 22, 00, 02, 04, 06 МСК.
  - If Execution Is Missed → *Run the Most Recent Missed Execution* (`coalesce_owner`): после сна Mac — один догоняющий запуск на оба правила, без параллельных дублей.
  - Было до 07.10.2026: `0 9-21/2 * * *` (7 запусков в день).
- **Manual Trigger** → имя `Manual` — для ручных запусков.
- Обе ноды соедини с `Any row`.

### 4.2 Any row — Data Table

**Data Table** → имя `Any row`:

- Resource: Row, Operation: **Get**, Data table: `vacancies`;
- условий не добавляй;
- Return All: off, Limit: `1`;
- вкладка **Settings** ноды → *Always Output Data*: on.

Зачем: узнать, первый ли это запуск. Пустая таблица → нода выдаёт пустой item → `Plan` включает бэкфилл.

### 4.3 Plan — Code

**Code** → имя `Plan` → вставь `n8n/w1-collector/plan.js`.

- Первый запуск: 2 item — `{page: 0, firstRun: true}` и `{page: 1, firstRun: true}`.
- Обычный запуск: 1 item `{page: 0, firstRun: false}`.

### 4.4 Search hh — HTTP Request

Скопируй ноду `Search hh` из W0 (`Cmd+C` в W0 → `Cmd+V` в W1). Изменения:

- Query Parameter `page` → `{{ $json.page }}`.
- Options → **Batching**: Items per Batch `1`, Batch Interval (ms) `3000`. На бэкфилле 2 страницы запрашиваются с паузой 3 с.

HTTP Request выполняется по разу на каждый входной item: сколько страниц вернул `Plan`, столько запросов.

### 4.5 Parse search — Code

**Code** → имя `Parse search` → вставь `n8n/w1-collector/parse-search.js`.

Нода собирает все страницы и выдаёт **один** item:

- `{ok: true, firstRun, vacancies: [...]}` — вакансии уже в формате строк таблицы. Дубли по регионам склеены по `dup_key`, регионы собраны в `areas`.
- `{ok: false, reason, html}` — блок или поломка: статус не 200, нет JSON страницы, 0 вакансий, у вакансий нет id/name.

### 4.6 OK? — If

**If** → имя `OK?` → условие: `{{ $json.ok }}` → тип **Boolean** → *is true*.

### 4.7 Ветка true

1. **Split Out** → имя `Split vacancies`: Fields To Split Out `vacancies`, Include: *No Other Fields*. Каждая вакансия становится отдельным item.
2. **Data Table** → имя `Is new`:
   - Row → **If Row Does Not Exist**, Data table `vacancies`;
   - Must Match: **Any Condition**;
   - условия: `external_id` *Equals* `{{ $json.external_id }}` и `dup_key` *Equals* `{{ $json.dup_key }}`.

   Дальше проходят только вакансии, которых нет в таблице ни по id, ни по ключу склейки.
3. **Data Table** → имя `Insert`: Row → **Insert**, Data table `vacancies`, Mapping Column Mode: **Map Automatically**.
4. **Code** → имя `Format message` → вставь `n8n/w1-collector/format-message.js`.
5. **Telegram** → *Send a text message*:
   - Chat ID: `{{ $env.TG_CHAT_ID }}`, Text: `{{ $json.text }}`;
   - Additional Fields: Parse Mode **HTML**, *Disable WebPage Preview* on, *Append n8n Attribution* off.

Новых нет → `Is new` отдаёт 0 item → дальше ничего не выполняется, сообщения нет. Так и задумано.

### 4.8 Ветка false

1. **Convert to File** → имя `To file`: Operation *Convert to Text File*, Text Input Field `html`, Options → File Name `hh-fail.html`.
2. **Read/Write Files from Disk** → имя `Save fixture`:
   - Operation: *Write File to Disk*;
   - File Path and Name (Expression): `/home/node/.n8n-files/fixtures/hh-fail-{{ $now.toFormat('yyyyLLdd-HHmmss') }}.html`;
   - Input Binary Field: `data`.
3. **Stop and Error** → имя `Stop`: Error Message (Expression) `{{ $('Parse search').first().json.reason }}`.

Итог: HTML страницы лежит в папке проекта `fixtures/` на Mac, workflow падает с понятной причиной, W4 присылает тревогу.

### 4.9 Настройки W1

⋯ → **Settings**:
- Error Workflow: `W4 Errors`;
- Timezone: `Europe/Moscow`.

Save.

## 5. Тесты (до Publish)

1. **Бэкфилл.** Таблица пустая → *Execute workflow*.
   - `Plan` — 2 item, `Parse search` — ~135 вакансий.
   - Telegram: «✅ Первый запуск: N текущих вакансий записано со статусом seen».
   - В таблице N строк со `status = seen`.
2. **Повтор.** *Execute workflow* ещё раз → `Plan` 1 item, `Is new` 0 item, сообщения нет.
3. **Новые.**
   - В таблице отсортируй по `published_at` (свежие сверху) и удали 2 верхние строки (чекбокс → Delete).
   - *Execute workflow* → Telegram: «🆕 Новые вакансии: 2» со ссылками.
   - У этих строк теперь `status = new`.
4. **Поломка.**
   - В `Search hh` временно поменяй URL на `https://hh.ru/search/vacancy-broken` → *Execute workflow*.
   - Ожидается: ветка false, в `fixtures/` появился `hh-fail-….html`, workflow падает с «hh ответил HTTP 404».
   - **Верни URL.** На ручном запуске тревога не придёт — W4 уже проверен в п. 3.
5. **Publish** (кнопка вверху). Дождись ближайшего нечётного часа по Москве → Overview → **Executions**: запуск зелёный.

## Если что-то не так

| Симптом | Причина / что сделать |
|---|---|
| Chat ID пустой, Telegram: `chat not found` | `TG_CHAT_ID` не дошёл до контейнера: проверь `.env`, `docker compose up -d`, `docker exec job-hunter-n8n printenv TG_CHAT_ID` |
| `Insert`: ошибка про колонку | имя колонки в таблице не совпадает с полем из кода — сверь со списком в п. 2 |
| Telegram: `can't parse entities` | сломан HTML в тексте — пришли мне вывод `Format message` |
| `Save fixture`: доступ запрещён | путь должен начинаться с `/home/node/.n8n-files/` |
| W1 упал, тревога не пришла | у W1 в Settings не выбран Error Workflow, или это был ручной запуск |

## Готово, когда

- W1 2–3 дня работает по расписанию;
- новые вакансии приходят списком;
- сбои приходят тревогой.

**Пришли мне:**
- сколько вакансий записалось в бэкфилле;
- сколько новых приходит за день;
- были ли тревоги;
- что в списке тебе явно не подходит.

Дальше этап 2: полное описание вакансии и быстрый фильтр. Перед ним задам вопросы про правила отбора.
