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
       → Format message   «🆕 Подходят: N» + «🚫 Отсеяно M: причина k …»
       → Telegram
```

- Нет прошедших — сообщения нет. Отсеянные видны в таблице `vacancies` (`status = rejected`, `reasons`).
- Страница вакансии не открылась → вакансия остаётся `new` с текстом в `error` и всё равно приходит в Telegram с ⚠️.
- Код: `n8n/w1-collector/filter-search.js`, `parse-vacancy.js`, `format-message.js`.

## Чёрный список

Таблица `blacklist` в n8n (Overview → Data tables → blacklist). Заполняешь сам:

| company | comment |
|---|---|
| `Займиго` | МФО |
| `2180` | id компании на hh — точное совпадение |

- `company` — кусок названия компании (без учёта регистра) **или** её id на hh (только цифры, видно в ссылке `hh.ru/employer/<id>`).
- Действует на следующих запусках W1; уже записанные вакансии не пересматриваются.

## Проверка правил

```bash
node scripts/run-code-node.mjs n8n/w1-collector/filter-search.js <vacancies.json> \
  --ref 'Is new=@<vacancies.json>' --ref 'Plan={"firstRun":false}' --ref 'Blacklist=[]'
node scripts/run-code-node.mjs n8n/w1-collector/parse-vacancy.js fixtures/vacancy.html \
  --ref 'Is candidate=@<row.json>'
```

## Деплой

```bash
node scripts/n8n-api.mjs migrate   # колонки contract, reasons, description, error + таблица blacklist
scripts/deploy.sh --publish
```

## Готово, когда

- 2–3 дня в Telegram приходят только подходящие вакансии;
- в сводке «Отсеяно» нет явных ошибок (проверить в таблице `reasons` у «только ТК» и «только из РФ»).
