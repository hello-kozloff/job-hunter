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
| Кнопки Telegram на локальном n8n | ✅ ngrok + Telegram Trigger (этап 4) | Статический домен ngrok, наружу только `/webhook/*`, интерфейс n8n — только localhost |

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
                 → Update (detailed | rejected) → Telegram: прошедшие + сводка отсеянных
[W2 Оценка]    (этап 3+) detailed → LLM-оценка → LLM-письмо → Telegram-карточка с кнопками → status=waiting
[W3 Telegram]  Telegram Trigger (callback кнопок, через ngrok) → обновить статус
[W4 Errors]    Error Trigger → Telegram (строится на этапе 1)
[W5 Сводка]    раз в день: найдено / подошло / откликнулся / ошибки
```

**Статусы:** `seen` (бэкфилл, не обрабатывается) | `new` (прошла выдачу; если `error` — страница не открылась) → `detailed` (прошла все правила, есть описание) | `rejected` (+ `reasons`) → этап 3+: `scored → ready → waiting → approved | skipped → applied | failed | needs_human`.

**Хранилище:** n8n Data Tables, таблица `vacancies`.
- Лимит поднят до 100 МБ env-переменной.
- Уникальность по `external_id`.
- Одна вакансия в разных регионах — это разные id. Склеиваем по `dup_key = hh:<company_id>:<нормализованное название>`; у скрытой компании — `hh:id:<id>`. Регионы копий собираются в `areas`.

**Схема `vacancies`:**
- источник правды — `n8n/schema.mjs`; новая колонка → `node scripts/n8n-api.mjs migrate`;
- этап 1: `source, external_id, dup_key, title, company, company_id, areas, salary_from, salary_to, currency, salary_gross, experience, employment_form, work_formats, languages, key_skills, has_test, letter_required, responses, snippet, url, apply_url, apply_type (hh|external|manual), published_at, status`;
- этап 2: `contract` (tk,self_employed,individual_entrepreneur,individual_person), `reasons`, `description` (текст ≤ 8000), `error`;
- добавить на этапах 3–4: `score, decision, red_flags, letter, tg_message_id`;
- таблица `blacklist`: `company, comment`;
- `id, createdAt, updatedAt` — встроенные.

**Telegram:**
- свой бот (токен в Credentials), один личный чат для всего;
- chat_id — в `.env` как `TG_CHAT_ID`, в нодах `{{ $env.TG_CHAT_ID }}` (Variables в Community edition нет);
- кнопки ловит W3 через Telegram Trigger. Локальному n8n нужен публичный HTTPS → ngrok, наружу только `/webhook/*`;
- не использовать «Send and wait» на каждую вакансию.

**Окружение n8n** (`docker-compose.yml`):
- порт только `127.0.0.1:5678`, TZ `Europe/Moscow`;
- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`;
- `./fixtures` → `/home/node/.n8n-files/fixtures`: файловые ноды n8n 2.x видят только `~/.n8n-files`.

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
- вход в REST ограничен по частоте (429 после нескольких логинов подряд) → `n8n-api.mjs` хранит cookie сессии в `.n8n-session` (права 600, не в git).

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

**Не фильтруем (решает LLM, этап 3):** зарплата (и без вилки), опыт 1–3 года, английский выше B1, оплата в валюте/USDT — ок.
**Форма оформления (ТК / ГПХ / ИП) — не важна, не фильтруем вообще** (07.10.2026; поле `contract` только для информации).
**Оставляем:** fullstack React + Node.js, fullstack React + другой бэкенд, React Native. Тест от работодателя — не отсекать, пометка (отклик вручную).



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
| **2. Детали + правила** ← **ТЕКУЩИЙ** | Filter search + Parse vacancy + таблица blacklist в W1 (`docs/stages/stage-2.md`). Развёрнуто 06.10.2026 22:15 МСК (W1 опубликован, blacklist 28 компаний); проверочный прогон на 8 вакансиях: 4 detailed, 4 rejected (Vue/Angular 3, чёрный список 1), Telegram дошёл | Полные описания, мусор отсеян |
| 3. Оценка | LLM, теневой режим неделю | Решения системы совпадают с мнением пользователя |
| 4. Письмо + Telegram | Writer, кнопки, W3, ngrok | **MVP: полуавтомат A** |
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

- **Сейчас:** наблюдение за фильтром этапа 2 — не режет ли лишнего (особенно «только из РФ»).
- **Этап 3:** LLM-провайдер (с тайского IP доступны OpenAI/Anthropic/Gemini; вариант — Ollama локально на M1 Pro 16 ГБ), бюджет, порог, теневой режим.
- **Этап 4:** язык и длина письма, контакты, кнопки, тихие часы (UTC+7), настройка ngrok.
- **Этап 6:** нужен ли VPS, если Mac с домашним IP справится сам.

## 13. Структура репозитория

```
docker-compose.yml, .env.example   n8n локально (.env — не в git, права 600)
docs/resume.md                      резюме (не в git)
docs/stages/stage-N.md              устройство этапов и ручная сборка
n8n/w0-check/*.js                   код Code-нод W0
n8n/w1-collector/*.js               код Code-нод W1
n8n/w4-errors/*.js                  код Code-нод W4
n8n/schema.mjs                      схема таблиц vacancies и blacklist
n8n/blacklist.json                  стартовый чёрный список компаний
n8n/workflows/*.json                сгенерированные workflow (не править руками)
scripts/build-workflows.mjs         описание workflow → n8n/workflows/*.json
scripts/deploy.sh                   сборка + импорт в n8n (+ credential Telegram из .env)
scripts/n8n-api.mjs                 владелец, запуск/публикация workflow, строки таблиц, migrate, blacklist-seed
scripts/telegram-credential.mjs     JSON credential из TG_BOT_TOKEN (только через pipe)
scripts/run-code-node.mjs           прогон Code-ноды на фикстурах без n8n
fixtures/                           страницы hh (не в git, кроме synthetic-*)
```

Workflow в n8n (постоянные id):

| id | Имя | Что |
|---|---|---|
| `jobHunterS0Setup` | S0 Setup | создать таблицы `vacancies` и `blacklist` (если нет) |
| `jobHunterS1TgTst` | S1 Telegram test | проверочное сообщение в Telegram |
| `jobHunterW0Check` | W0 Check hh | ручная проверка «жив ли hh» |
| `jobHunterW1Colle` | W1 Collector | сбор каждые 2 ч |
| `jobHunterW4Error` | W4 Errors | тревоги |

Credential: `jobHunterTgBot01` «Telegram bot».
