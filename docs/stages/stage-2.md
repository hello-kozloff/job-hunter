# Этап 2 — детали вакансии и быстрый фильтр

**Цель:** в Telegram приходят только вакансии, которые проходят правила пользователя, с полным описанием в таблице. Мусор отсеивается бесплатно, без LLM.

Правила и их происхождение — CLAUDE.md §7.

## Как устроено (W1 после «Is new»)

```
Is new → Blacklist (все строки таблицы blacklist, один раз)
       → Filter search    правила по данным выдачи → status new | rejected, reasons
       → Insert           все вакансии пишутся в таблицу
       → Is candidate?    только status = new
       → Vacancy page     страница вакансии (по одной, пауза 3 с)
       → Parse vacancy    описание, навыки, тест, ТК/ГПХ + правила по описанию → detailed | rejected
       → Update           запись обратно по id
```

- Сообщения в Telegram с этапа 3 шлёт W2: карточка на каждую `detailed` + сообщение о сборе, где отсеянные перечислены с причинами: «🚫 Название — причина» (`docs/stages/stage-3.md`). Отсеянные видны в таблице `vacancies` (`status = rejected`, `reasons`).
- Страница вакансии не открылась → вакансия всё равно `detailed` с текстом в `error`: нейросеть оценит её по фрагменту из выдачи, в карточке ⚠️.
- Код: `n8n/w1-collector/filter-search.js`, `parse-vacancy.js`.
- AI-вакансии (07.10.2026, `n8n/shared/ai.js`: AI, ИИ, LLM, GenAI, GPT, RAG, агенты, нейросети — в названии, на странице ещё и в навыках) берём только на JS/TS: правило «бэкенд» их не режет, а «нет React и Vue» заменяется на «AI не на JS/TS» — нет Node.js, NestJS, TypeScript или JavaScript в тексте. «Чужой стек» (Ruby, C#/.NET, Java, Go, Python без JS/TS в названии) режет и их.

## Чёрный список

Таблица `blacklist` в n8n (Overview → Data tables → blacklist).

| company | comment |
|---|---|
| `Ozon Tech` | точное название компании, как в карточке вакансии на hh |
| `2180` | id компании на hh |

- `company` — **точное** название компании (регистр, лишние пробелы и форма организации — ООО, АО, ПАО… — не важны) **или** её id на hh (только цифры, видно в ссылке `hh.ru/employer/<id>`).
- Подразделения на hh — отдельные названия: «Альфа-Банк» не отсекает «Альфа-Банк. ИТ-специалисты», их надо добавлять отдельной строкой.
- Стартовый список пользователя (07.10.2026, 26 компаний) — `n8n/blacklist.json`, загружается `node scripts/n8n-api.mjs blacklist-seed` (дописывает только отсутствующих). Дальше можно править прямо в UI.
- Действует на следующих запусках W1; уже записанные вакансии не пересматриваются.

## Правило поменялось — перепроверить отсеянных

```bash
node scripts/n8n-api.mjs recheck 'Vue/Angular' --dry   # что удалится: rejected с этим правилом в reasons
node scripts/n8n-api.mjs recheck 'Vue/Angular'         # удалить строки (только те, что есть в последней выдаче W1)
node scripts/n8n-api.mjs run jobHunterW1Colle          # W1 примет их как новые и прогонит через текущие правила
```

07.10.2026 так вернули Vue-вакансии: правило «Vue/Angular» стало «Angular», страница вакансии отсекает только «нет React и Vue».

## Проверка правил

```bash
node scripts/run-code-node.mjs n8n/w1-collector/filter-search.js <vacancies.json> \
  --ref 'Is new=@<vacancies.json>' --ref 'Plan={"firstRun":false}' --ref 'Blacklist=[]'
node scripts/run-code-node.mjs n8n/w1-collector/parse-vacancy.js fixtures/vacancy.html \
  --ref 'Is candidate=@<row.json>'
```

## Деплой

```bash
node scripts/n8n-api.mjs migrate          # колонки contract, reasons, description, error + таблица blacklist
node scripts/n8n-api.mjs blacklist-seed   # компании из n8n/blacklist.json
scripts/deploy.sh --publish
```

## Готово, когда

- 2–3 дня в Telegram приходят только подходящие вакансии;
- в сводке «Отсеяно» нет явных ошибок (проверить в таблице `reasons` у «только из РФ»).
