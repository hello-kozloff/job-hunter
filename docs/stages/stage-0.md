# Этап 0 — локальный n8n и проверка hh.ru

> **Статус: выполнен 06.10.2026.** n8n 2.42.3 поднят в Docker, W0 импортирован скриптом (`scripts/deploy.sh`) и прогнан 3 раза: поиск и страница вакансии — `OK`, 163 вакансии.
> Ниже — как это устроено и как собрать W0 руками, если захочешь разобраться. Повторная проверка «жив ли hh»: открой W0 в n8n → *Execute workflow*.

**Цель:** поднять n8n в Docker на Mac и убедиться, что из него hh.ru отдаёт и поиск, и страницу вакансии.
**Время:** ~30 минут.

Структуру страниц hh я уже проверил с этого Mac 06.10.2026: всё работает, капчи нет. Этот этап — то же самое, но изнутри n8n, на котором дальше будет жить система.

---

## 1. Запуск n8n

В папке проекта:

```bash
cp .env.example .env
openssl rand -hex 32
```

Вставь результат второй команды в `.env` → `N8N_ENCRYPTION_KEY=...`.
Сохрани ключ ещё и в менеджер паролей: без него сохранённые в n8n credentials (токен бота, ключи LLM) не расшифровать после переустановки.

```bash
docker compose up -d
docker compose logs -f n8n
```

Дождись строки `Editor is now accessible via: http://localhost:5678` → `Ctrl+C` (контейнер продолжит работать).

1. Открой http://localhost:5678 → создай аккаунт владельца. Он локальный, никуда не отправляется.
2. Версия n8n: ⚙️ Settings (внизу слева) → **About n8n**. Впиши её в `.env` → `N8N_VERSION=<версия>` и выполни `docker compose up -d`. Так n8n обновится только когда ты сам решишь (`docker compose pull && docker compose up -d`).

Полезные команды:

| Команда | Что делает |
|---|---|
| `docker compose ps` | запущен ли контейнер |
| `docker compose restart n8n` | перезапуск |
| `docker compose up -d` | применить изменения `.env` / `docker-compose.yml` (данные сохраняются) |
| `docker compose down` | остановить (данные в volume `n8n_data` сохраняются) |

## 2. Настройки Mac и Docker

- **Docker Desktop → Settings → General →** включи *Start Docker Desktop when you sign in to your computer*. Контейнер с `restart: unless-stopped` поднимется вместе с Docker.
- **Сон.** Пока Mac спит, запуски по расписанию пропускаются. Это не страшно: каждый запуск забирает 100 последних вакансий, пропуск в несколько часов ничего не теряет. Чтобы Mac не засыпал от сети с погашенным экраном: System Settings → Battery → Options → *Prevent automatic sleeping on power adapter when the display is off*. С закрытой крышкой без внешнего монитора MacBook всё равно уснёт.
- **Data Tables.** Слева **Overview** → вкладка **Data tables** должна быть. Если её нет — пришли версию n8n.

## 3. Workflow «W0 Check hh»

Overview → **Create Workflow** → назови `W0 Check hh`. Цепочка:

```
Manual → Search hh → Check search → Vacancy page → Check vacancy
```

Ноды переименовывай точно как указано (двойной клик по названию ноды или F2). Код ссылается на ноды по имени.

### 3.1 Manual

Нода **Manual Trigger** → имя `Manual`. Настроек нет.

### 3.2 Search hh — HTTP Request

Нода **HTTP Request** → имя `Search hh`.

| Поле | Значение |
|---|---|
| Method | `GET` |
| URL | `https://hh.ru/search/vacancy` |
| Send Query Parameters | on → *Using Fields Below* |
| Send Headers | on → *Using Fields Below* |

**Query Parameters** (кнопка *Add Parameter* на каждую строку):

| Name | Value |
|---|---|
| `text` | `NAME:(frontend OR front-end OR фронтенд OR react OR next.js OR nextjs OR typescript)` |
| `professional_role` | `96` |
| `work_format` | `REMOTE` |
| `education` | `not_required_or_not_specified` |
| `order_by` | `publication_time` |
| `items_on_page` | `100` |
| `enable_snippets` | `true` |
| `page` | `0` |

`NAME:(…)` — язык запросов hh: искать слова только в названии вакансии. `professional_role=96` — «Программист, разработчик». `enable_snippets` добавляет в выдачу куски требований и навыков — они пригодятся фильтру.

**Headers:**

| Name | Value |
|---|---|
| `User-Agent` | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36` |
| `Accept` | `text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8` |
| `Accept-Language` | `ru-RU,ru;q=0.9,en;q=0.8` |

**Options → Add Option:**

| Опция | Значение | Зачем |
|---|---|---|
| Redirects → Follow Redirects | off | редирект на капчу будет виден как 3xx + `location`, а не спрятан |
| Response → Include Response Headers and Status | on | в выводе появятся `statusCode` и `headers` |
| Response → Never Error | on | 403/429 не роняют ноду — вердикт поставит код |
| Response → Response Format | `Text` | страница придёт строкой в поле `data` |
| Timeout | `30000` | |

**Execute step** → в выводе `statusCode: 200` и огромный `data` (~1,7 МБ). n8n может спросить, показывать ли такие данные, — можно не показывать.

### 3.3 Check search — Code

Нода **Code** → имя `Check search` → Mode: *Run Once for All Items*, Language: *JavaScript* → вставь целиком `n8n/w0-check/check-search.js`.

Выход: `verdict`, `totalResults`, `vacanciesOnPage`, `sample` (5 примеров) и `vacancyId` — его возьмёт следующая нода.

### 3.4 Vacancy page — HTTP Request

Скопируй `Search hh` (выдели → `Cmd+C` → `Cmd+V`) → имя `Vacancy page`. Изменения:

- URL → `https://hh.ru/vacancy/{{ $json.vacancyId }}`. Когда наберёшь `{{`, поле само переключится в режим Expression.
- Send Query Parameters → off.
- Headers → добавь `Referer` = `https://hh.ru/search/vacancy`.

Options остаются как были.

### 3.5 Check vacancy — Code

Нода **Code** → имя `Check vacancy` → вставь `n8n/w0-check/check-vacancy.js`.

Выход: `verdict` и данные из двух источников — `jsonLd` (разметка для поисковиков) и `initialState` (JSON состояния страницы: полное описание, навыки, тест).

## 4. Запуск

**Execute workflow** 3 раза с паузой 1–2 минуты.

Ожидается:

- `Check search`: `verdict: "OK"`, `vacanciesOnPage: 100`, `totalResults` ≈ 160.
- `Check vacancy`: `verdict: "OK"`, заполнены `jsonLd` и `initialState`, в `keySkills` — список навыков.

| verdict | Значит | Что делать |
|---|---|---|
| `OK` | всё работает | готово |
| `CAPTCHA`, `NO_STATE`, `HTTP_403`, `HTTP_429` | hh не пускает | пришли `htmlStart` и `location`, повтори через час |
| `HTTP_301`, `HTTP_302` | редирект | пришли `location` |
| `PARSE_ERROR`, `EMPTY`, `NO_DATA`, `LD_ONLY` | сменилась структура страницы | пришли вывод ноды — поправлю парсер |

## Готово, когда

- оба вердикта `OK` во всех 3 прогонах;
- вкладка Data tables есть.

**Пришли мне:** вердикты, `totalResults` и версию n8n. После этого — [этап 1](stage-1.md).

W0 не удаляй: пригодится как быстрый тест «жив ли hh», если сборщик начнёт падать.
