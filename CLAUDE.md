# Job Hunter — автопоиск и отклик на вакансии (n8n)

Контекст проекта для Claude Code. Перенесено из чата в claude.ai (06.10.2026), дополнено в сессии Claude Code 06.10.2026.
Резюме пользователя: `docs/resume.md`.

---

## 1. Цель

Система в n8n, которая:
1. сама мониторит вакансии (сначала hh.ru, потом другие сайты);
2. отбирает по правилам пользователя;
3. пишет сопроводительное письмо (LLM);
4. откликается, включая случаи с внешней веб-формой.

## 2. Пользователь и среда

- Никита Костров, Senior Frontend (React / Next.js / TypeScript), 5+ лет. Гражданство РФ, **живёт в Таиланде (UTC+7 = МСК+4)**, ищет **удалёнку**. В резюме на hh указан Санкт-Петербург.
- **n8n 2.42.3 self-hosted в Docker на Mac** (M1 Pro, 16 ГБ, почти всегда включён, Docker Desktop). IP — домашний тайский. n8n Cloud не используем. VPS нет.
- Опыт пользователя с n8n: собирал простые workflow.
- **Формат работы (с 06.10.2026, по просьбе пользователя «продолжи дальше сам»):** workflow собирает и разворачивает Claude, пользователь смотрит результат в UI (логин — в `.env`).
  - код Code-нод — `n8n/<workflow>/*.js` (единственный источник правды);
  - `scripts/build-workflows.mjs` генерирует JSON workflow в `n8n/workflows/`;
  - `scripts/deploy.sh` импортирует их в n8n (`--publish` — включает расписание W1);
  - `scripts/n8n-api.mjs run <id>` запускает workflow и печатает сводку по нодам;
  - `docs/stages/stage-N.md` — описание устройства и ручная сборка (для понимания).
- **На каждом этапе задавать максимум уточняющих вопросов** (просьба пользователя).
- Структура: один инстанс n8n, внутри отдельные workflow на каждый участок. Связь между ними — через общую таблицу и статусы.

## 3. Журнал решений

| Путь | Статус | Причина |
|---|---|---|
| API hh — отклики (`/negotiations`) | ❌ закрыт | hh закрыл API соискателей с 15.12.2025 |
| API hh — поиск (`GET /vacancies`) | ❌ нет доступа | Нужен токен приложения (без токена капча после 1-го запроса). Регистрация приложения недоступна пользователю по юридическим причинам |
| Webhook API hh | ❌ | Все методы только для работодателей |
| Telegram-бот hh через юзербот (Telethon) | ❌ отклонено пользователем | — |
| Письма автопоиска hh → Gmail Trigger | ⏸ запасной план | Не выбран, но легален и без риска бана |
| **HTTP-запросы к сайту hh.ru + парсинг HTML** | ✅ **выбран, проверен** | 06.10.2026 с Mac (тайский домашний IP): поиск и страница вакансии отдаются без капчи |
| n8n Cloud | ❌ не используем | Пользователь выбрал self-hosted: бесплатно, без лимита executions, домашний IP. Блокирует ли hh облачные IP — не проверяли, не нужно |
| Кнопки Telegram на локальном n8n | ✅ ngrok + Telegram Trigger (перенесено на этап 3) | Контейнер ngrok в docker compose, бесплатный постоянный домен; наружу только `/webhook/*` с адресов Telegram, интерфейс n8n — только localhost |
| Нейросеть для оценки | ✅ Gemini Flash-Lite, бесплатный тариф (07.10.2026) | Пользователь выбрал бесплатно; при исчерпании лимитов — ручное переключение на Claude Haiku 4.5 (`LLM_PROVIDER=claude`). В промпт уходит резюме целиком (бесплатный Gemini может учиться на запросах — пользователь согласен) |

Устаревшие артефакты из чата (не использовать): `01_collector.json` (на API hh), `explore_hh_bot.py` (юзербот).

## 4. Выбранный метод — разбор

Две разные задачи.

### Чтение: поиск + страница вакансии

Публичные страницы, вход не нужен, аккаунт не рискует. Риск: капча/блок по IP.

Проверено 06.10.2026. Фикстуры лежат в `fixtures/`, в git не входят.

**Поиск `/search/vacancy`:**
- `<template id="HH-Lux-InitialState">` — JSON состояния страницы **с HTML-сущностями** (`&#34;` и т. п.). Раскодировать за один проход, потом `JSON.parse`.
- `vacancySearchResult.vacancies` — все 100 вакансий страницы; `totalResults` — сколько всего.
- Поля вакансии: `vacancyId`, `name`, `company{id,visibleName}`, `compensation{from,to,currencyCode,gross}` или `noCompensation`, `publicationTime.$`, `creationTime`, `workExperience`, `employmentForm`, `workFormats[].workFormatsElement`, `languages[].language[{isoCode,degree}]`, `userTestPresent`, `@responseLetterRequired`, `totalResponsesCount`, `snippet{req,resp,cond,skill}` (с `enable_snippets=true`), `area.name`.
- В HTML-разметке только ~20 карточек из 100 → **селекторы `data-qa` не используем**.
- `page=1` работает.

**Страница вакансии `/vacancy/<id>`:**
- JSON-LD `JobPosting`: title, description (HTML), datePosted, validThrough, hiringOrganization.name, jobLocation. **Зарплаты нет.**
- InitialState → `vacancyView.vacancyFull.vacancy`: `description` (HTML), `keySkills[]`, `workExperience`, `employmentForm`, `workFormats[]`, `compensation`, `languages`, `status.archived`, `area.countryIsoCode`, `acceptLaborContract`, `civilLawContracts`.
- `applicantVacancyResponseStatuses[<id>]`: `test{hasTests,testId,required}`, `letterMaxLength`.
- Признак внешнего отклика (аналог `response_url` из API) на сайте пока не найден — проверить на этапе 2.

### Отклик

Требует аккаунта.

| Путь | Суть | Решение |
|---|---|---|
| A. Полуавтомат | n8n готовит всё, шлёт в Telegram карточку + письмо + ссылку на отклик, пользователь жмёт сам | ✅ **MVP**. Без VPS, риск бана ноль |
| B. HTTP с cookies | Повтор запроса отклика с cookies сессии | ❌ хрупко (xsrf, протухание сессии), легко спалиться |
| C. Playwright | Робот-браузер с постоянным профилем | ⏭ после MVP. Нарушает правила hh, риск ограничений. Может работать на том же Mac (домашний IP) — VPS не обязателен |

Ссылка на отклик на hh имеет вид `https://hh.ru/applicant/vacancy_response?vacancyId=<ID>`.

## 5. Поисковый запрос

Рабочий запрос (W0, W1):

```
https://hh.ru/search/vacancy?text=NAME:(frontend OR front-end OR фронтенд OR react OR next.js OR nextjs OR typescript)&professional_role=96&work_format=REMOTE&education=not_required_or_not_specified&order_by=publication_time&items_on_page=100&enable_snippets=true&page=0
```

- `NAME:(…)` — язык запросов hh: искать только в названии. Синонимы (Frontend ↔ Фронтенд) hh подставляет сам.
- `professional_role=96` — «Программист, разработчик».
- `education=not_required_or_not_specified` важен: у пользователя среднее образование.
- Регионы — все (параметра `area` нет): РФ, Казахстан, Узбекистан, Беларусь, Грузия, Сербия, Израиль…
- Замер 06.10.2026: 161–162 вакансии (2 страницы), после склейки дублей — 135. Новых ~5–10 в день → обычному запуску хватает page 0.
- Шум в выдаче: React Native, fullstack (.NET/Python + React), Vue/Angular. Его режет фильтр этапа 2.
- Старые варианты:
  - `text=Frontend` по названию + компании + описанию: 531 вакансия, по делу ~15% — не использовать;
  - `text=Frontend&search_field=name`: 99 вакансий, теряет «React-разработчик».

## 6. Архитектура

```
[W0 Check hh]  ручная проверка «жив ли hh» (этап 0)
[W1 Collector] Schedule (0 9-21/2 * * *, МСК) → поиск hh → разбор InitialState → склейка дублей
                 → только новые (нет ни external_id, ни dup_key) → Blacklist + Filter search (правила по выдаче)
                 → Insert (new | rejected) → для new: страница вакансии → Parse vacancy (правила по описанию)
                 → Update (detailed | rejected)
[W2 Score]     Schedule (15 9-21/2 * * *) → detailed → резюме + промпт → Gemini | Claude → apply/maybe/skip + причина
                 → карточка в Telegram с кнопками ✅/🤔/❌ → status = waiting → сводка + тревоги (429 и т. п.)
[W3 Telegram]  Telegram Trigger (вебхук через ngrok) → кнопка: my_decision, status, перерисовать карточку,
                 при расхождении с нейросетью «Почему?» → ответ (reply) → my_reason
[W2+ Письмо]   (этап 4) approved → LLM-письмо → Telegram
[W4 Errors]    Error Trigger → Telegram (строится на этапе 1)
[W5 Сводка]    раз в день: найдено / подошло / откликнулся / ошибки
```

**Статусы:** `seen` (бэкфилл, не обрабатывается) | `new` (прошла выдачу) → `detailed` (прошла все правила; если `error` — страница не открылась, оценка по фрагменту) | `rejected` (+ `reasons`) → `waiting` (W2: решение нейросети, карточка отправлена) → `approved` (✅) | `maybe` (🤔) | `skipped` (❌) → этап 4+: `applied | failed | needs_human`.

**Хранилище:** n8n Data Tables, таблица `vacancies`.
- Лимит поднят до 100 МБ env-переменной.
- Уникальность по `external_id`.
- Одна вакансия в разных регионах — это разные id. Склеиваем по `dup_key = hh:<company_id>:<нормализованное название>`; у скрытой компании — `hh:id:<id>`. Регионы копий собираются в `areas`.

**Схема `vacancies`:**
- источник правды — `n8n/schema.mjs`; новая колонка → `node scripts/n8n-api.mjs migrate`;
- этап 1: `source, external_id, dup_key, title, company, company_id, areas, salary_from, salary_to, currency, salary_gross, experience, employment_form, work_formats, languages, key_skills, has_test, letter_required, responses, snippet, url, apply_url, apply_type (hh|external|manual), published_at, status`;
- этап 2: `contract` (tk,self_employed,individual_entrepreneur,individual_person), `reasons`, `description` (текст ≤ 8000), `error`;
- этап 3: `decision` (apply|maybe|skip|error), `llm_reason`, `llm_model`, `my_decision` (кнопка), `my_reason` (ответ на «Почему?»), `tg_message_id` (карточка), `tg_ask_id` (вопрос «Почему?»);
- этап 4: `letter`;
- таблица `blacklist`: `company, comment`;
- `id, createdAt, updatedAt` — встроенные.

**Telegram:**
- свой бот (токен в Credentials), один личный чат для всего;
- chat_id — в `.env` как `TG_CHAT_ID`, в нодах `{{ $env.TG_CHAT_ID }}` (Variables в Community edition нет);
- кнопки ловит W3 через Telegram Trigger (v1.5: проверяет секретный заголовок, Restrict to Chat IDs = TG_CHAT_ID). Публичный HTTPS → контейнер ngrok (`COMPOSE_PROFILES=tunnel`, `ngrok/policy.yml`), `WEBHOOK_URL=https://<NGROK_DOMAIN>/` (→ `N8N_WEBHOOK_URL`);
- callback_data кнопок: `v:<id строки>:<apply|maybe|skip|edit>`;
- тихие часы: 23:00–09:00 по Таиланду — карточки и сводка без звука (`disable_notification`), тревоги со звуком;
- не использовать «Send and wait» на каждую вакансию.

**Окружение n8n** (`docker-compose.yml`):
- порт только `127.0.0.1:5678`, TZ `Europe/Moscow`;
- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`;
- `./fixtures` → `/home/node/.n8n-files/fixtures`: файловые ноды n8n 2.x видят только `~/.n8n-files`;
- `./docs` → `/home/node/.n8n-files/docs` (только чтение): резюме для промпта W2;
- нейросеть: `LLM_PROVIDER` (gemini | claude), `GEMINI_MODEL` (по умолчанию `gemini-flash-lite-latest`), `CLAUDE_MODEL` (`claude-haiku-4-5`).

**Особенности n8n 2.x (проверено на 2.42.3):**
- «Publish» вместо «Activate»; импорт workflow через CLI снимает публикацию со всех → `deploy.sh` всегда публикует W4, W1 — с `--publish`; CLI-публикацию запущенный n8n видит только после перезапуска (`deploy.sh` перезапускает сам);
- **Error workflow (W4) должен быть опубликован** — иначе в логе «Workflow … is not active and cannot be executed» (документация n8n утверждает обратное — неверно для 2.42);
- Code-ноды работают в task runner: без `require` и `process.env`;
- Error workflow не срабатывает на ручных запусках;
- HTTP Request (Response Format = Text + Include Response Headers and Status) кладёт тело в поле **`data`**, не `body`;
- CLI `n8n execute` не грузит модули → Data Table в нём не работает («module is disabled»). Workflow с таблицами запускать через REST `POST /rest/workflows/:id/run` (`scripts/n8n-api.mjs run`); второй CLI-процесс — с `N8N_RUNNERS_BROKER_PORT=5681`;
- Telegram-нода без `parse_mode` шлёт Markdown (символ `_` ломает отправку) → всегда `parse_mode: HTML` + экранирование;
- Data Table: таблицу можно указать по имени (`mode: name`), Insert «Map Automatically» пишет все поля item → поля должны совпадать с колонками;
- Schedule Trigger 1.4: `misfirePolicy: coalesce` — после сна Mac выполняется последний пропущенный запуск;
- `import:credentials` принимает данные открытым текстом и сам шифрует их ключом из `.env`;
- вход в REST ограничен по частоте (429 после нескольких логинов подряд) → `n8n-api.mjs` хранит cookie сессии в `.n8n-session` (права 600, не в git);
- REST `/executions?filter=`: `status` — только массив (`["success"]`), строка → 400;
- Data Table Insert/Update «Map Automatically» отправляет все поля item, кроме id/createdAt/updatedAt → лишние поля ломают запись. Нужно несколько колонок — `defineBelow` (`setColumns()` в build-workflows.mjs);
- Data Table Get умеет сортировку и по системным колонкам (`createdAt`, `updatedAt`);
- Telegram-нода возвращает `{ ok, result: { message_id } }`; с `onError: continueRegularOutput` ошибка отправки — item `{ error }`;
- HTTP Request с credential: `authentication: predefinedCredentialType` + `nodeCredentialType` (`googlePalmApi` кладёт ключ в `?key=`, `anthropicApi` — в `x-api-key`);
- `N8N_WEBHOOK_URL` — актуальное имя (просто `WEBHOOK_URL` в 2.42 устарел);
- execution order v1: ветки одной ноды выполняются по очереди сверху вниз — так W2 шлёт сводку после карточек.

## 7. Правила отбора

Решения пользователя (06–07.10.2026). Код: `n8n/w1-collector/filter-search.js` (по выдаче) и `parse-vacancy.js` (по странице вакансии).

**Отсекаем по выдаче (Filter search):**
- опыт «нет опыта»; junior / стажёр / intern / младший;
- Vue или Angular в названии — даже вместе с React;
- Lead / тимлид / архитектор / руководитель / head / CTO — кроме гибридов с Senior/Middle/старший/ведущий;
- стоп-слова в названии: PHP, 1С, WordPress, Битрикс, QA/тестировщик, преподаватель/наставник/teacher/tutor;
- больше 3000 откликов;
- компания из таблицы `blacklist` (точное название компании как в карточке hh, без учёта регистра, или id компании на hh). Стартовый список пользователя — `n8n/blacklist.json` (28 компаний, 07.10.2026) → `n8n-api.mjs blacklist-seed`; дальше правит в UI.

**Отсекаем по странице вакансии (Parse vacancy):**
- архив / закрыта для откликов;
- «только из РФ / находиться на территории РФ / резидент РФ / located in Russia» (цитата пишется в `reasons`);
- нет React / Next.js ни в названии, ни в навыках, ни в описании.

**Решает нейросеть (W2, промпт `n8n/w2-score/build-prompt.js`; 07.10.2026):**
- skip: основной стек не React (React «плюсом» — тоже skip); мобильная разработка, в том числе React Native; английский C1+ или общение только на английском; нужно жить в определённой стране (не только РФ) или ездить в офис; работа ночью по Таиланду (часы США);
- maybe: любой fullstack (бэкенд на любом языке, включая Node.js); английский B2; мягкие требования к стране/офису («желательно»); мало данных;
- apply: React/Next.js — основной стек, удалёнка без привязки к стране;
- не влияет: Middle/Senior и требуемый опыт (Middle — apply), зарплата (не учитывать вообще), форма оформления, график по МСК (любой, включая строгий 9–18), сфера бизнеса (любая), тестовое;
- «сборщиков резюме» нейросеть не распознаёт — их пользователь сам вносит в `blacklist`.
**Не фильтруем кодом:** зарплата (и без вилки), опыт 1–3 года, английский, оплата в валюте/USDT — ок.
**Форма оформления (ТК / ГПХ / ИП) — не важна, не фильтруем вообще** (07.10.2026; поле `contract` только для информации).
**Фильтр кодом пропускает** fullstack и React Native — их оценивает нейросеть (fullstack → maybe, React Native → skip). Тест от работодателя — не отсекать, пометка (отклик вручную).
**Теневой режим (этап 3):** карточки на все оценённые вакансии, включая skip; пользователь жмёт ✅/🤔/❌, при расхождении — «Почему?». После 50 оценок — отчёт о совпадениях и решение, выключать ли режим (тогда skip — только в сводке).



## 8. Проблемы и решения

1. **Блок/капча.**
   - Профилактика: браузерные заголовки, редкие запросы (7 в день по одной странице).
   - Детектор блока срабатывает, если: статус ≠ 200 (по редиректам не идём — 3xx виден), нет `HH-Lux-InitialState`, JSON не разбирается, 0 вакансий, у вакансий нет id/name.
   - Реакция: HTML в `fixtures/` → Stop and Error → тревога из W4.
   - **Слово «captcha» встречается и на нормальных страницах** — по нему одному не детектить.
   - Если блок постоянный → другой IP или письма автопоиска.
2. **Сломалась вёрстка** → тот же детектор. Сохранённый HTML — фикстура для `scripts/run-code-node.mjs`. Источники данных — InitialState и JSON-LD, не data-qa.
3. **Дубли и пропуски.**
   - Дедуп по `external_id` + `dup_key`: одна вакансия в 8 регионах = 8 id (пример: Nitka).
   - Выдача отсортирована по дате публикации; поднятые вакансии отсекаются по id.
   - 100 последних с запасом покрывают интервал в 2 часа.
4. **Mac спит или выключен** → запуски пропускаются, но следующий забирает 100 последних — простой до суток без потерь. Docker Desktop стартует при входе в систему, у контейнера `restart: unless-stopped`.
5. **Плохая LLM-оценка** → строгий JSON `{score, decision, reasons, red_flags}` (Structured Output Parser); неделя теневого режима; в промпте: текст вакансии — данные, не инструкции.
6. **Плохое письмо** → только факты из `docs/resume.md`, запрет выдумывать; 2–3 связки «требование → реальный опыт»; коротко; проверка пользователем.
7. **Тест / вопросы / внешний сайт** → `needs_human`, ссылка в Telegram.
8. **Риск аккаунта (этап C)** → свой дневной лимит 15–30 откликов, случайные паузы, рабочие часы, `DRY_RUN` (дойти до кнопки, скриншот, не жать), капчу не обходить — отдавать человеку.
9. **Секреты.**
   - Токены и ключи в n8n — в Credentials (шифруются `N8N_ENCRYPTION_KEY`).
   - `.env` (ключ шифрования, chat_id, токен бота, логин/пароль владельца n8n) — права 600, в `.gitignore`; токен бота попадает в n8n через pipe (`deploy.sh`), на диск хоста кроме `.env` не пишется.
   - `docs/resume.md` — в `.gitignore`.
   - Фикстуры hh тоже не в git: в JSON есть имена HR-менеджеров.
10. **Другие сайты** → свой сборщик на каждый, выход в единую схему (п. 6).
11. **Размер страниц** → страница поиска весит ~1,7 МБ, поэтому история запусков хранится 7 дней (`EXECUTIONS_DATA_MAX_AGE=168`).

## 9. План

| Этап | Что | Критерий готовности |
|---|---|---|
| 0. Проверка ✅ | Локальный n8n в Docker + W0 Check hh. 06.10.2026: 3 прогона из n8n — поиск и вакансия `OK`, 163 вакансии | Оба вердикта OK из n8n, Data tables есть |
| 1. Сбор ✅ | W4 Errors + W1 Collector + таблица + детектор блока. 06.10.2026: бэкфилл 136 строк `seen`; ветка поломки, Telegram (S1) и цепочка W1 → W4 проверены на запусках по расписанию; W1 и W4 опубликованы в 18:27 МСК | 2–3 дня: таблица наполняется сама, новые вакансии и тревоги — в Telegram |
| 2. Детали + правила ✅ | Filter search + Parse vacancy + таблица blacklist в W1 (`docs/stages/stage-2.md`). Развёрнуто 06.10.2026 22:15 МСК (W1 опубликован, blacklist 28 компаний); проверочный прогон на 8 вакансиях: 4 detailed, 4 rejected (Vue/Angular 3, чёрный список 1) | Полные описания, мусор отсеян |
| **3. Оценка + кнопки** ← **ТЕКУЩИЙ** | W2 (Gemini → apply/maybe/skip, карточки), W3 (кнопки, «Почему?»), ngrok (`docs/stages/stage-3.md`). Код и тесты на моках готовы 07.10.2026; ждём ключ Gemini и ngrok от пользователя | 50 оценок, решения нейросети совпадают с пользователем |
| 4. Письмо | Writer по approved, ссылка на отклик | **MVP: полуавтомат A** |
| 5. Мониторинг | W5 | Сводка каждый день |
| 6. Playwright | автоотклик hh, DRY_RUN, лимиты (на Mac или VPS) | Отклик без клика |
| 7. Веб-формы | LLM-сопоставление полей + Playwright | Меньше `needs_human` |
| 8. Другие источники | Habr Карьера и др. | Больше вакансий |

Точка решения после этапа 0: если hh блокирует и домашний IP — письма автопоиска или другой IP; остальной план не меняется.

## 10. Тестирование

- `scripts/run-code-node.mjs` — прогон кода Code-ноды на сохранённых страницах hh без n8n (моки `$input` и `$('Node')`):
  ```bash
  node scripts/run-code-node.mjs n8n/w1-collector/parse-search.js \
    fixtures/search-p0.html,fixtures/search-p1.html --ref 'Plan={"firstRun":true}'
  ```
- Фикстуры: `fixtures/search-p0.html`, `search-p1.html`, `vacancy.html` (не в git) и `synthetic-captcha.html` (в git).
- В живом n8n: `node scripts/n8n-api.mjs run jobHunterW1Colle` (сводка по нодам), `node scripts/n8n-api.mjs rows vacancies 5`.
- Проверка ветки поломки: временно импортировать W1 с битым URL под тем же id → run → вернуть `scripts/deploy.sh`.
- Pin data: 10–15 реальных вакансий разных типов, включая «ловушки» (Angular под видом Frontend, React Native, .NET + React, «только из РФ»).
- Флаг `DRY_RUN` — в `.env` / `$env`.
- Тест веб-форм — на своих тестовых формах, не на работодателях.
- Запуск: 3–5 откликов в день с подтверждением, потом больше.

## 11. Справка: API hh (на случай, если появится токен)

Изучено по официальной документации (api.hh.ru/openapi/redoc):
- `GET /vacancies`: без токена капча после первого запроса (403); заголовок `HH-User-Agent` обязателен; неизвестные параметры молча игнорируются; глубина выдачи ≤ 2000; `per_page` ≤ 100.
- Полезные параметры: `search_field` (несколько, по умолчанию все поля), `experience` (несколько), `work_format`, `education`, `date_from` (ISO, нельзя вместе с `period`, округление до 5 мин — для инкрементального сбора), `excluded_text` (слова через запятую), `label` (`not_from_agency`, `with_salary`), `responses_count_enabled=true` (поле `counters.responses`), `no_magic=true`.
- Устарели: `schedule`, `employment`, `only_with_salary`, `part_time`, `premium`.
- `GET /vacancies/{id}`: полезные поля — `description`, `key_skills`, `experience`, `salary_range`, `work_format`, `response_letter_required`, `has_test`, `test.required`, `response_url` (не null = отклик на внешнем сайте), `apply_alternate_url`, `archived`, `closed_for_applicants`, `languages`, `internship`.

## 12. Открытые вопросы к пользователю

- **Сейчас:** ключ Gemini и аккаунт ngrok (инструкция — `docs/stages/stage-3.md`, «Настройка»); затем бэкфилл за 3 дня (`requeue 3`). Наблюдение за фильтром этапа 2 — не режет ли лишнего (особенно «только из РФ»).
- **После 50 оценок:** отчёт о совпадениях, правка промпта, выключать ли теневой режим.
- **Этап 4:** язык и длина письма, контакты, когда писать (по ✅ сразу?), формат в Telegram.
- **Этап 6:** нужен ли VPS, если Mac с домашним IP справится сам.

## 13. Структура репозитория

```
docker-compose.yml, .env.example   n8n локально (.env — не в git, права 600)
docs/resume.md                      резюме (не в git)
docs/stages/stage-N.md              устройство этапов и ручная сборка
n8n/w0-check/*.js                   код Code-нод W0
n8n/w1-collector/*.js               код Code-нод W1
n8n/w2-score/*.js                   код Code-нод W2 (промпт, разбор ответа, карточки, сводка)
n8n/w3-telegram/*.js                код Code-нод W3 (кнопки, «Почему?»)
n8n/shared/*.js                     общий код Code-нод (карточка), подключается строкой // @include
n8n/w4-errors/*.js                  код Code-нод W4
n8n/schema.mjs                      схема таблиц vacancies и blacklist
n8n/blacklist.json                  стартовый чёрный список компаний
n8n/workflows/*.json                сгенерированные workflow (не править руками)
scripts/build-workflows.mjs         описание workflow → n8n/workflows/*.json
scripts/deploy.sh                   сборка + туннель + credentials из .env + импорт и публикация workflow
scripts/n8n-api.mjs                 владелец, запуск/публикация workflow, строки таблиц, migrate, blacklist-seed,
                                    tunnel-env, requeue
scripts/credentials.mjs             JSON credentials Telegram / Gemini / Claude из .env (только через pipe)
scripts/run-code-node.mjs           прогон Code-ноды на фикстурах без n8n (--ref, --env)
scripts/lib/code.mjs                чтение кода Code-ноды с раскрытием // @include
ngrok/policy.yml                    что туннель пускает внутрь: адреса Telegram, только /webhook/*
fixtures/                           страницы hh (не в git, кроме synthetic-*)
```

Workflow в n8n (постоянные id):

| id | Имя | Что |
|---|---|---|
| `jobHunterS0Setup` | S0 Setup | создать таблицы `vacancies` и `blacklist` (если нет) |
| `jobHunterS1TgTst` | S1 Telegram test | проверочное сообщение в Telegram |
| `jobHunterW0Check` | W0 Check hh | ручная проверка «жив ли hh» |
| `jobHunterW1Colle` | W1 Collector | сбор каждые 2 ч (:00) |
| `jobHunterW2Score` | W2 Score | оценка нейросетью и карточки (:15) |
| `jobHunterW3Teleg` | W3 Telegram | кнопки и ответы «Почему?» (вебхук) |
| `jobHunterW4Error` | W4 Errors | тревоги |

Credentials: `jobHunterTgBot01` «Telegram bot», `jobHunterGemini1` «Gemini», `jobHunterClaude1` «Claude».
