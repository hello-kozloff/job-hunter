# Job Hunter

Личный помощник для поиска работы на hh.ru, собранный на self-hosted [n8n](https://n8n.io). Что он делает:
- сам собирает свежие вакансии;
- отсеивает неподходящие по правилам;
- просит нейросеть оценить остальные;
- присылает карточки в Telegram и пишет сопроводительные письма;
- по кнопке 🚀 откликается сам через робота-браузера.

Решение об отклике всегда принимает человек.

> Полный контекст проекта: журнал решений, правила отбора, особенности n8n 2.x и план — в [CLAUDE.md](CLAUDE.md). Устройство каждого этапа описано в [docs/stages/](docs/stages/).

## Как это работает

```
W8 Clock ──► W1 Collector ──► W2 Score ──► карточка в Telegram ──► ✅ / 🤔 / ❌
(расписание)  поиск hh,        нейросеть:                         │
              фильтр, детали   apply/maybe/skip                   ▼
                                                   W5 Letter: письмо ──► 🚀 ──► W9 Robot ──► applier ──► hh.ru
```

- **Сбор.** Поиск и страницы вакансий берутся с сайта hh.ru (InitialState и JSON-LD), API соискателей hh закрыт с 15.12.2025. Выдача за сутки умещается на одной странице.
- **Отбор.** Сначала код отсеивает очевидное: стоп-слова, чужой стек, «только из РФ», чёрный список. Спорное решает нейросеть: Gemini Flash-Lite, Claude по API-ключу или Claude по своей подписке Pro/Max (`docs/claude-cli.md`) — переключаются в боте.
- **Решение — за человеком.** Под карточкой кнопки ✅ / 🤔 / ❌. Если решение расходится с нейросетью, бот спрашивает «Почему?» — так копятся данные для правки промпта.
- **Письмо.** Только факты из резюме, по-русски, 400–700 знаков, в стиле своих образцов писем (по желанию).
- **Отклик.** Кнопка 🚀 под письмом ставит вакансию в очередь робота: Playwright, отдельный контейнер `applier/`. Капчу робот отдаёт человеку, есть дневные лимиты и предохранитель `APPLY_LIVE`.
- **Надзор:**
  - тревоги о сбоях (W4);
  - утренняя сводка (W6);
  - внешний страж [healthchecks.io](https://healthchecks.io) — пишет в Telegram, если сборы прекратились.

### Workflow

| id | Имя | Что делает |
|---|---|---|
| `jobHunterS0Setup` | S0 Setup | Создаёт таблицы `vacancies` и `blacklist` |
| `jobHunterS1TgTst` | S1 Telegram test | Шлёт проверочное сообщение в Telegram |
| `jobHunterW0Check` | W0 Check hh | Проверяет вручную, отдаёт ли hh поиск и вакансию |
| `jobHunterW1Colle` | W1 Collector | Сбор: поиск → фильтр → страница вакансии → правила |
| `jobHunterW2Score` | W2 Score | Оценка нейросетью и карточки в Telegram |
| `jobHunterW3Teleg` | W3 Telegram | Нажатия кнопок, ответы «Почему?», меню (вебхук через ngrok) |
| `jobHunterW4Error` | W4 Errors | Тревоги: повторы склеиваются, «✅ снова работает» |
| `jobHunterW5Lettr` | W5 Letter | Сопроводительные письма |
| `jobHunterW6Summ1` | W6 Summary | Сводка в 10:00 по местному (запускает W8), устаревшие и закрытые карточки, чистка |
| `jobHunterW7Menu1` | W7 Bot menu | Меню бота: вакансии, статистика, ⚙️ настройки |
| `jobHunterW8Clock` | W8 Clock | Раз в 15 минут решает по настройкам, пора ли собирать и слать сводку |
| `jobHunterW9Robot` | W9 Robot | Очередь 🚀, отклик через робота, капча, блоки |
| `jobHunterW11Prof` | W11 Profile | Профиль: онбординг по резюме PDF, ⚙️ → 👤 |

Данные лежат в n8n Data Tables: `vacancies`, `blacklist`, `runs`, `settings`, `alerts`. Схема — [n8n/schema.mjs](n8n/schema.mjs). Статусы вакансии и колонки описаны в [CLAUDE.md §6](CLAUDE.md).

## Установка

Одна установка — один человек: свой бот, свой ключ нейросети, свой компьютер. Профессия любая — поиск и правила отбора бот соберёт по резюме.

**Нужно:**
- компьютер, который почти всегда включён: Mac, Linux или Windows 10/11. Проверено на Mac; на Linux и Windows — по инструкции, без проверки;
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (на Windows — с WSL 2), [Node.js](https://nodejs.org) 22+, git;
- Telegram и свой бот: [@BotFather](https://t.me/BotFather) → `/newbot`, это пара минут;
- нейросеть: ключ [Gemini](https://aistudio.google.com/apikey) (бесплатно), ключ [Claude API](https://console.anthropic.com) (платно) или подписка Claude Pro/Max — токен `claude setup-token`, мастер поможет (`docs/claude-cli.md`; лимит общий с claude.ai и Claude Code).
  ⚠️ Из России Gemini не работает (Google блокирует), а Claude запрещён правилами Anthropic. В ЕС, Великобритании и Швейцарии бесплатного Gemini нет;
- бесплатный аккаунт [ngrok](https://dashboard.ngrok.com) — туннель, через который приходят нажатия кнопок в Telegram. Нужны Authtoken и бесплатный домен.

```bash
git clone -b production <адрес репозитория> job-hunter
cd job-hunter
node scripts/install.mjs
```

**Мастер спросит:**
- токен бота — и попросит нажать «Запустить» по ссылке, так он узнает твой чат;
- ключ нейросети — и проверит его пробным запросом; по желанию — Claude по подписке Pro/Max (запустит `claude setup-token`, токен вставишь сам);
- токен и домен ngrok;
- почту для входа в интерфейс n8n (можно пропустить).

**Остальное сделает сам:** ключ шифрования, часовой пояс компьютера, n8n в Docker, таблицы, workflow. В конце бот пришлёт приветствие → отправь ему **резюме в PDF**: с hh — «Мои резюме» → резюме → «Скачать» → PDF. Бот покажет, что понял, спросит подпись, контакт для HR и часовой пояс — и начнёт искать. Подробно — [docs/onboarding.md](docs/onboarding.md).

- **Обновление:** `git pull && node scripts/install.mjs` — заполненное он не спрашивает.
- **Вторая установка рядом** (например, проверить): `node scripts/install.mjs --project jh-test --port 5690` в другой папке. Нужны второй бот и второй аккаунт ngrok — бесплатный ngrok держит один туннель. Без кнопок бота (только сообщения) — `--no-tunnel`, ngrok не нужен.
- **Компьютер не должен спать**, иначе сборы пропускаются (после пробуждения — один догоняющий). На Mac: на зарядке и с запретом сна при погашенном экране. Docker Desktop — автозапуск при входе в систему.
- **Интерфейс n8n** — `http://localhost:5678`, логин и пароль — в `.env` (`N8N_OWNER_EMAIL`, `N8N_OWNER_PASSWORD`).
- **Секреты** — только в `.env`. Сохрани `N8N_ENCRYPTION_KEY` в менеджер паролей: без него ключи в n8n не расшифровать.

### По желанию

- **Страж** [healthchecks.io](https://healthchecks.io) — пишет в Telegram, если сборы прекратились. Создай check с расписанием сбора, впиши в `.env` `HC_PING_URL` и `HC_API_KEY` (тогда смена расписания в боте обновит стража сама), затем `node scripts/deploy.mjs`. Подробно — [docs/stages/stage-5.md](docs/stages/stage-5.md).
- **Робот-отклик** — откликается сам по кнопке 🚀 под письмом:
  ```bash
  # .env: APPLIER_TOKEN=<случайная строка>, VNC_PASSWORD (≤ 8 символов), APPLY_LIVE=0
  node scripts/deploy.mjs --applier     # сборка и запуск контейнера робота
  node scripts/applier.mjs login        # вход в hh в окне робота
  node scripts/applier.mjs status       # браузер работает, вход выполнен, блока нет
  ```
  Окно робота — VNC `localhost:5901`: на Mac — «Общий экран» (`vnc://localhost:5901`), на Windows и Linux — любой VNC-клиент. Живые отклики — `APPLY_LIVE=1` и снова `--applier`. Включить робота в боте: ⚙️ → 🚀 Робот. Автоматизация откликов — против правил hh, риск ограничений аккаунта на тебе. Подробно — [docs/stages/stage-6.md](docs/stages/stage-6.md).

### Для разработчика

Деплой по git flow — `scripts/deploy.sh`: проверяет ветку (`develop` / `production`) и вызывает `scripts/deploy.mjs`. Перенос профиля между установками и бэкап:
```bash
node scripts/n8n-api.mjs profile-export docs/profile.json   # в git не попадает
node scripts/n8n-api.mjs profile-import docs/profile.json
```

## Работа с ботом

- **Карточка вакансии:**
  - ✅ — откликнуться, бот пришлёт письмо;
  - 🤔 — подумать;
  - ❌ — пропустить;
  - 📨 — уже откликался;
  - 🚫 — компанию в чёрный список.
- **Письмо:**
  - 📝 — отклик на hh;
  - 🔗 — вакансия;
  - 🔄 — переписать; ответ на письмо текстом — переписать по пожеланию;
  - 📨 — отправил;
  - 🚀 — откликнуться роботом.
- **Профиль:** резюме PDF файлом в чат → «Вот что я понял» → подпись, контакт, часовой пояс → первый сбор. Потом ⚙️ → 👤 Профиль: правка словами, дополнение, образцы писем; новое резюме — снова PDF в чат.
- **Меню под полем ввода:**
  - 📋 Вакансии — список по вкладкам, `/v<id>` открывает вакансию;
  - 📊 Статистика;
  - ⚙️ Настройки: 👤 профиль, 🕐 сбор, 🔎 поиск, 🧹 фильтр, 🤖 нейросеть, 🚀 робот.

  Подробно — [docs/bot-menu.md](docs/bot-menu.md) и [docs/settings.md](docs/settings.md).
- **Тихие часы:** 23:00–09:00 по твоему времени (часовой пояс компьютера или `profile.tz`). Карточки и сводка приходят без звука, тревоги — со звуком.

## Скрипты

| Команда | Что делает |
|---|---|
| `node scripts/install.mjs` | Мастер установки и обновления: ключи, бот, n8n, деплой, приветствие. `--project <имя> --port <n>` — вторая установка рядом, `--no-tunnel` — без ngrok и кнопок |
| `node scripts/deploy.mjs` | Сборка и деплой без git flow. Флаги: `--paused` (без сбора и сводки), `--applier` (пересобрать робота, дождавшись конца отклика) |
| `scripts/deploy.sh` | То же для владельца репозитория: только с `develop` или `production` (`--any-branch` — осознанно в обход) |
| `node scripts/build-workflows.mjs` | Код Code-нод `n8n/**/*.js` → JSON workflow в `n8n/workflows/`. JSON руками не править |
| `node scripts/n8n-api.mjs run <id>` | Запуск workflow со сводкой по нодам |
| `node scripts/n8n-api.mjs rows <таблица> [N]` | Последние строки таблицы |
| `node scripts/n8n-api.mjs migrate` | Недостающие таблицы и колонки по `n8n/schema.mjs` |
| `node scripts/n8n-api.mjs profile-import <json>` / `profile-export [json]` | Профиль и настройки бота: загрузить в таблицу `settings` / выгрузить (бэкап, перенос) |
| `node scripts/n8n-api.mjs requeue <дни>` / `recheck <правило>` | Вернуть вакансии в обработку |
| `node scripts/applier.mjs status \| login \| resume \| shot` | Состояние робота, вход в hh, снятие блока, скриншот |
| `node scripts/applier.mjs apply <id> --letter-file f` | Сухой прогон отклика: до кнопки, без клика |
| `node scripts/run-code-node.mjs <файл.js> <фикстуры>` | Прогон Code-ноды на сохранённых страницах без n8n |

Полный список команд — в шапке каждого скрипта.

## Тесты

```bash
# Code-нода на сохранённых страницах hh
node scripts/run-code-node.mjs n8n/w1-collector/parse-search.js \
  fixtures/search-p0.html,fixtures/search-p1.html --ref 'Plan=[{"label":"удалёнка","page":0},{"label":"удалёнка","page":1}]'

cd applier && npm ci && npm test   # чистые функции робота
applier/sim/run.sh                 # робот на поддельном hh в контейнере без сети
```

Страницы hh для тестов лежат в `fixtures/` и в git не входят: в них имена HR-менеджеров. Исключение — `fixtures/synthetic-*`. Подробнее — [CLAUDE.md §10](CLAUDE.md).

## Структура

```
docker-compose.yml, .env.example   n8n, туннель ngrok (профиль tunnel), робот (профиль applier)
n8n/<workflow>/*.js                код Code-нод — единственный источник правды
n8n/shared/*.js                    общий код, подключается строкой // @include
n8n/workflows/*.json               сгенерированные workflow (не править руками)
n8n/schema.mjs, n8n/blacklist.json схема таблиц, стартовый чёрный список
scripts/                           сборка, деплой, клиент API n8n, CLI робота, прогон Code-нод
applier/                           робот-отклик: Playwright + HTTP API, тесты, симуляция
ngrok/policy.yml                   туннель пускает только адреса Telegram и только /webhook/*
docs/                              этапы, меню бота, настройки, git flow
fixtures/                          страницы hh для тестов (не в git)
```

## Git flow

Ветки:
- `production` — проверенное на живых запусках, точка отката;
- `develop` — интеграция, с неё деплой;
- `feature/*` — от `develop`, вливаются через PR.

Релиз — PR `develop` → `production` и тег `vГГГГ.ММ.ДД`. Коммиты, PR и имена веток пишутся по-английски, в формате Conventional Commits. Подробно — [docs/git-flow.md](docs/git-flow.md).

## Безопасность и данные

- Секреты лежат только в `.env` (права 600, вне git). В n8n они попадают как credentials, зашифрованные `N8N_ENCRYPTION_KEY`. Токен Claude по подписке и ключ Gemini (запасной путь) — ещё и в env контейнера `claude-cli`; порта у него нет, его видит только n8n.
- Интерфейс n8n, API и окно робота доступны только с этого компьютера (`127.0.0.1`). Наружу через ngrok открыт лишь `/webhook/*` и только для адресов Telegram.
- Резюме уходит в выбранную нейросеть (Gemini или Claude) — для разбора, оценки вакансий и писем. Бесплатный Gemini может использовать данные для обучения, подписка Claude — если в claude.ai включено «Help improve Claude»; об этом бот предупреждает при первом запуске.
- Резюме, образцы писем, страницы hh и данные робота (профиль браузера, сессия hh) в git не попадают.
- Робот автоматизирует действия в аккаунте hh. Это против правил hh, и риск ограничений аккаунта принят. Поэтому робот:
  - откликается только по кнопке;
  - соблюдает дневные лимиты;
  - отдаёт капчу человеку;
  - ничего не нажимает, пока не включён `APPLY_LIVE=1`.

## Документация

| Файл | О чём |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Контекст проекта: цели, решения, архитектура, правила отбора, план |
| [docs/stages/stage-0.md](docs/stages/stage-0.md) … [stage-6.md](docs/stages/stage-6.md) | Этапы: как устроено и как собрать руками |
| [docs/bot-menu.md](docs/bot-menu.md) | Меню бота: кнопки, панель, callback_data |
| [docs/settings.md](docs/settings.md) | Настройки из бота, расписание сбора, страж healthchecks |
| [docs/onboarding.md](docs/onboarding.md) | Установка для всех: профиль в таблице, пресеты, онбординг, мастер |
| [docs/claude-cli.md](docs/claude-cli.md) | Claude по подписке: сервис claude-cli, токен, модели, лимит и запасной Gemini |
| [docs/git-flow.md](docs/git-flow.md) | Ветки, PR, релизы, правила коммитов |
