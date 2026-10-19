# Сверка с «Откликами» hh: отметить откликнутые вакансии

> **Статус:** план утверждён 20.10.2026, к работе не приступали. Выполнить позже — по шагам «Порядок» ниже.
>
> **Срок:** Telegram даёт боту удалять сообщения только 48 ч. Карточки от 19.10 удаляются до ~21.10 08:00 UTC; позже их можно только перерисовать без кнопок (этот путь в плане уже есть).

## Context

19.10.2026 `sweep` + сборы W1/W2 дали 102 карточки `waiting` (99 от 19.10, 3 от 17.10). На многие пользователь уже
откликался руками на hh (вчера 🚀 шесть раз вернул `already`). Нужно найти такие среди вакансий без отклика, перевести
в `applied`, карточки из чата удалить — не рискуя аккаунтом hh.

Решения пользователя (20.10.2026): охват — все без отклика; карточки — удалить; состояние hh (отказ/приглашение)
не писать.

## Подход

**Робот листает твой список «Отклики» (`/applicant/negotiations`, 20 на странице), а не открывает 140 вакансий.**
На 10.10 было 136 откликов = 7 страниц, сейчас ~8–12. Человек листает свои отклики 3–5 минут — обычное поведение.
Проверено на `fixtures/applier/inbox-20261010-180531`: InitialState страницы — `topicList` (`vacancyId`,
`creationTime`, `resumeId`) + `vacanciesShort` (название, `company.id`); в разметке у каждого отклика ссылка
`/vacancy/<id>?hhtmFrom=negotiation_list`; пейджер — **кнопки** `data-qa="number-pages-N"` без href (параметра
`page=` в HTML нет).

Два шага, как `sweep`: чтение hh (только просмотр) → файл → сухой показ → твоё «ок» → запись и Telegram.

### Шаг 1. Робот: чтение «Откликов» (applier)

- `applier/src/hh/state.mjs`: чистая `negotiationTopics(state)` → `{ selected, pageCount, total, counters, topics:
  [{ topicId, vacancyId, creationTime, lastModified, name, companyId }] }` (без HR, писем, чатов). Рядом с
  `negotiationsSummary` (`state.mjs:175`).
- `applier/src/flows/recon.mjs`: `readNegotiations({ maxPages }, progress)`:
  - **предохранитель обычный** (`setGuard(true)`, как у `reconInbox`): он и так рвёт запись в `/applicant/…` и chatik
    (отказ, удаление, «чат открыт»). Строгий не берём — он рвёт телеметрию и антифрод-маячок hh (`/api/fl`), а
    страница без них выделяется. Все не-GET запросы страницы — пассивно в итог (метод + путь);
  - страница 1 — `page.goto(NEGOTIATIONS_URL)`, данные из InitialState;
  - дальше — **клик по кнопке следующей страницы**, как человек: `humanRead` (3.5–8 с, прокрутка) →
    `pause(6000, 15000)` → клик `[data-qa^="number-pages-<N+1> "]` (соседняя кнопка видна всегда) → ждать
    `number-pages-<N+1> number-pages-selected` (15 с, нет — стоп). Данные: JSON-ответ hh со `topicList`, пойманный
    во время клика (`page.on('response')`), или свежий InitialState, если клик перезагрузил страницу; запасной путь —
    id вакансий из ссылок `negotiation_list` в разметке (тогда без даты);
  - в конце — снова `goto(NEGOTIATIONS_URL)` (обновить страницу): отклик, где работодатель что-то сделал за время
    чтения, всплывает наверх — объединяем по `topicId`, сверяем число с `total`; счётчики `counters.new` до и после —
    в итог (проверка, что чтение ничего не пометило);
  - стоп: капча (`store.block('captcha')`, как у разведки), выход из hh (`isLoginUrl` / `userType`), страница не
    переключилась; потолок `maxPages` (по умолчанию `pageCount`, жёстко ≤ 40);
  - итог — `fixtures/applier/negotiations-<stamp>/topics.json` + `summary.json`.
- `applier/src/server.mjs`: `POST /recon { negotiations: true, maxPages? }` — фоновая работа под замком (`startJob`),
  как `inbox/resume/chooser` (`server.mjs:265`): W9 в это время не откликается.
- `scripts/applier.mjs`: `recon --negotiations [--pages N]`.
- Тест: `applier/test/state.test.mjs` — `negotiationTopics` на синтетическом state.

### Шаг 2. Таблица и Telegram (n8n-api)

- `scripts/lib/hh-applied.mjs` (чистая, как `lib/sweep.mjs`) — `planHhApplied({ rows, topics })`:
  - цели — `status ∈ waiting | approved | maybe | skipped | expired | new | detailed` (W6 скоро переведёт карточки
    17.10 в `expired`; `new/detailed` — чтобы хвост сборов не прислал карточку), без `apply_state` и `letter_lock`;
  - совпадение по `external_id === vacancyId`; совпадение только по `dup_key` (`hh:<companyId>:<normTitle(name)>`,
    `parse-search.js:26`) — отдельным списком, пишется только с `--dup` (может быть новая вакансия с тем же названием);
  - `rejected` с откликом — только в отчёт;
  - запись — **как у робота для `already`** (`n8n/w9-robot/result.js:46`): `status = applied`, `apply_by = hh`,
    `apply_result = already`, `applied_at = creationTime` отклика (нет даты — пусто); `my_decision` не трогаем
    (теневой режим и твои решения как были; карточка покажет «📨 Отклик есть на hh 08.10»).
- `scripts/n8n-api.mjs hh-applied <topics.json> [--dry] [--dup]`:
  - печать: по статусам; список `/v<id> название — компания · статус · 🤖 решение · 📨 дата`; отдельно дубли,
    `skipped`/`maybe` с откликом, `rejected` с откликом; оговорка: удалённые тобой отклики hh в списке не видны;
  - `--dry` — ничего не пишет;
  - на время записи — замок `runs` (`kind = hh-applied`, как `sweep`, `n8n-api.mjs:251`): W1 пропустит сбор;
  - PATCH по строке: фильтр `id eq` + `status eq <прежний>` + `apply_state isEmpty` + `letter_lock isEmpty`,
    `returnData: true` — нажал кнопку в это время → строка не вернулась → её не трогаем и в Telegram тоже;
  - Telegram (`TG_BOT_TOKEN`, `TG_CHAT_ID` из `.env`, пауза ~0.4 с): `deleteMessage` карточки, письма
    (`tg_letter_id`), «Почему?» (`tg_ask_id`); удалённые — id в строке очистить (иначе W7 «↩️ Изменить» правит
    несуществующее сообщение, `render.js:176`). Старше 48 ч Telegram не удаляет (3 карточки 17.10, старые
    `approved`) → карточку перерисовать `cardText` (`n8n/shared/card.js` через `scripts/lib/sandbox.mjs`, пояс —
    из settings) без кнопок, у письма снять кнопки. Сбой Telegram запись не останавливает — счётчик в итоге.
- Тест: `scripts/test-hh-applied.mjs` — id и дубли, статусы вне цели, `apply_state`, `applied_at`.

### Не делаем

Страницы вакансий и чаты не открываем; `hh_state` не пишем (это 6.2 W10 — ему пригодится `readNegotiations`);
workflow n8n не меняем (деплой только робота).

## Что изменилось после разбора

| Было в черновике | Стало | Почему |
|---|---|---|
| строгий предохранитель | обычный + журнал запросов | строгий рвёт антифрод-маячок hh — так заметнее |
| `?page=N` / ссылка «дальше» | клик по кнопке страницы | пейджер — кнопки без href |
| `my_decision = earlier` | как робот для `already` | не трогать теневой режим и сводку «📨 раньше» |
| PATCH без проверки | `returnData` + условия | не удалить карточку, которую ты только что нажал |
| id сообщений оставались | очищаются | W7 правил бы удалённое сообщение |
| дубли пишутся | только с `--dup` | может быть новая вакансия |
| цели без expired/new | с ними + замок runs | W6 и хвост сборов |

Отвергнуто: открывать каждую вакансию (140 просмотров); chatik API (запросы из Node — другой отпечаток TLS); запись
в VNC руками (`record`) — безопаснее всего, но листать тебе; оставляю запасным путём, если hh покажет капчу.

## Порядок

1. Ветка `feature/hh-applied-sync` от `origin/develop`, код + тесты (`cd applier && npm test`,
   `node --test scripts/test-*.mjs`), PR → merge → `scripts/deploy.sh --any-branch --applier` с `origin/develop`.
2. `applier.mjs status` — вошёл, без блока, не занят (сейчас так).
3. `recon --negotiations --pages 2` (~30 с) — проверить клик и разбор.
4. Полный прогон (~3–5 мин). Капча → стоп, сообщу.
5. `hh-applied <topics.json> --dry` → показать тебе список → «ок».
6. Запись + удаление карточек. Срок: карточки 19.10 Telegram даёт удалить до ~21.10 08:00 UTC.
7. Документы: CLAUDE.md §10, §13; `docs/stages/stage-6.md` (6.2: как читать «Отклики»); память.

## Проверка

- Тесты зелёные; `summary.json`: страниц = `pageCount`, число откликов = `total`, `counters.new` не изменились,
  в журнале нет записи в `/applicant/…`.
- После записи: повторный `hh-applied --dry` → 0 к записи; `rows vacancies` — `applied`, `apply_by = hh`.
- Telegram: карточки отмеченных пропали (старше 48 ч — без кнопок); W7 «📋 Вакансии» — во вкладке откликов.
- 2–3 вакансии глазами в «Откликах» hh.
