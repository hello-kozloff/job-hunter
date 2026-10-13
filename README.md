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
- **Отбор.** Сначала код отсеивает очевидное: стоп-слова, чужой стек, «только из РФ», чёрный список. Спорное решает нейросеть: Gemini Flash-Lite или Claude Haiku, переключаются в боте.
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

Данные лежат в n8n Data Tables: `vacancies`, `blacklist`, `runs`, `settings`, `alerts`. Схема — [n8n/schema.mjs](n8n/schema.mjs). Статусы вакансии и колонки описаны в [CLAUDE.md §6](CLAUDE.md).

## Установка с нуля

**Нужно:**
- Mac с Docker Desktop (окно робота открывается через «Общий экран» macOS);
- Node.js 22+, git, [GitHub CLI](https://cli.github.com) (для git flow);
- аккаунты: Telegram, [ngrok](https://dashboard.ngrok.com) (бесплатный), [Google AI Studio](https://aistudio.google.com/apikey), по желанию healthchecks.io и [Anthropic](https://console.anthropic.com).

1. **Окружение:**
   ```bash
   cp .env.example .env && chmod 600 .env
   openssl rand -hex 32   # → .env: N8N_ENCRYPTION_KEY=… (сохрани и в менеджер паролей)
   ```
2. **n8n:**
   ```bash
   docker compose up -d                              # http://localhost:5678
   node scripts/n8n-api.mjs setup-owner you@mail.com # владелец n8n, пароль запишется в .env
   node scripts/n8n-api.mjs migrate                  # таблицы и колонки по n8n/schema.mjs
   node scripts/n8n-api.mjs blacklist-seed           # по желанию: стартовый чёрный список
   ```
3. **Telegram.** Создай бота у [@BotFather](https://t.me/BotFather) → `TG_BOT_TOKEN`. Напиши боту `/start` и узнай chat_id через `https://api.telegram.org/bot<токен>/getUpdates` → `TG_CHAT_ID` (подробно — [docs/stages/stage-1.md](docs/stages/stage-1.md)).
4. **Нейросеть и туннель для кнопок.** В `.env`:
   - `GEMINI_API_KEY`;
   - `NGROK_AUTHTOKEN`, `NGROK_DOMAIN`;
   - по желанию `ANTHROPIC_API_KEY`.

   Подробно — [docs/stages/stage-3.md](docs/stages/stage-3.md).
5. **Профиль:** резюме, подпись, контакт, образцы писем. Это строки таблицы `settings`, подробно — [docs/onboarding.md](docs/onboarding.md). Пока онбординга в боте нет, профиль загружается из JSON (в git не попадает):
   ```bash
   node scripts/n8n-api.mjs profile-import docs/profile.json   # бэкап: profile-export docs/profile.json
   ```
6. **Деплой:**
   ```bash
   scripts/deploy.sh   # сборка workflow, credentials из .env, импорт, публикация, перезапуск n8n
   ```
7. **Ключ API n8n для сводки W6:**
   ```bash
   node scripts/n8n-api.mjs api-key | docker exec -i job-hunter-n8n sh -c \
     'cat > /tmp/c.json && n8n import:credentials --input=/tmp/c.json; rm -f /tmp/c.json'
   ```
8. **Страж (по желанию).** На healthchecks.io создай check с расписанием сбора. В `.env` впиши `HC_PING_URL` и `HC_API_KEY` (тогда смена расписания в боте обновит стража сама), потом `scripts/deploy.sh`. Подробно — [docs/stages/stage-5.md](docs/stages/stage-5.md).
9. **Робот-отклик (по желанию):**
   ```bash
   # .env: APPLIER_TOKEN=$(openssl rand -hex 24), VNC_PASSWORD (≤ 8 символов), APPLY_LIVE=0
   scripts/deploy.sh --applier        # сборка и запуск контейнера робота
   node scripts/applier.mjs login     # вход в hh в окне робота: «Общий экран» → vnc://localhost:5901
   node scripts/applier.mjs status    # браузер работает, вход выполнен, блока нет
   ```
   Живые отклики — `APPLY_LIVE=1` и снова `scripts/deploy.sh --applier`. Включить робота в боте: ⚙️ → 🚀 Робот. Подробно — [docs/stages/stage-6.md](docs/stages/stage-6.md).

Чтобы сбор шёл ночью, Mac должен не спать: на зарядке и с запретом сна при погашенном экране. Docker Desktop должен стартовать при входе в систему.

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
- **Меню под полем ввода:**
  - 📋 Вакансии — список по вкладкам, `/v<id>` открывает вакансию;
  - 📊 Статистика;
  - ⚙️ Настройки: 🕐 сбор, 🔎 поиск, 🧹 фильтр, 🤖 нейросеть, 🚀 робот.

  Подробно — [docs/bot-menu.md](docs/bot-menu.md) и [docs/settings.md](docs/settings.md).
- **Тихие часы:** 23:00–09:00 по твоему времени (часовой пояс компьютера или `profile.tz`). Карточки и сводка приходят без звука, тревоги — со звуком.

## Скрипты

| Команда | Что делает |
|---|---|
| `scripts/deploy.sh` | Сборка и деплой. Только с `develop` или `production`. Флаги: `--paused` (без сбора и сводки), `--applier` (пересобрать робота, дождавшись конца отклика), `--any-branch` |
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
  fixtures/search-p0.html,fixtures/search-p1.html --ref 'Plan={"firstRun":true}'

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

- Секреты лежат только в `.env` (права 600, вне git). В n8n они попадают как credentials, зашифрованные `N8N_ENCRYPTION_KEY`.
- Интерфейс n8n, API и окно робота доступны только с этого компьютера (`127.0.0.1`). Наружу через ngrok открыт лишь `/webhook/*` и только для адресов Telegram.
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
| [docs/git-flow.md](docs/git-flow.md) | Ветки, PR, релизы, правила коммитов |
