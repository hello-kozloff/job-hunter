// Схема таблиц Data Tables — общая для сборщика workflow (S0 Setup) и миграции (scripts/n8n-api.mjs migrate).
// Имена колонок vacancies = поля, которые пишут Code-ноды W1 (Insert/Update «Map Automatically»).
// Новая колонка: добавить сюда → `node scripts/n8n-api.mjs migrate`.

export const TABLES = {
  vacancies: [
    ['source', 'string'],
    ['external_id', 'string'],
    ['dup_key', 'string'],
    ['title', 'string'],
    ['company', 'string'],
    ['company_id', 'string'],
    ['areas', 'string'],
    ['salary_from', 'number'],
    ['salary_to', 'number'],
    ['currency', 'string'],
    ['salary_gross', 'boolean'],
    ['experience', 'string'],
    ['employment_form', 'string'],
    ['work_formats', 'string'],
    ['languages', 'string'],
    ['key_skills', 'string'],
    ['has_test', 'boolean'],
    ['letter_required', 'boolean'],
    ['responses', 'number'],
    ['snippet', 'string'],
    ['url', 'string'],
    ['apply_url', 'string'],
    ['apply_type', 'string'],
    ['published_at', 'string'],
    ['status', 'string'],
    // этап 2
    ['contract', 'string'],
    ['reasons', 'string'],
    ['description', 'string'],
    ['error', 'string'],
    // этап 3: решение нейросети (W2) и пользователя (кнопки W3)
    ['decision', 'string'],
    ['llm_reason', 'string'],
    ['llm_model', 'string'],
    ['my_decision', 'string'],
    ['my_reason', 'string'],
    ['tg_message_id', 'number'],
    ['tg_ask_id', 'number'],
    // этап 4: письмо (W5) и отклик
    ['letter', 'string'],
    ['tg_letter_id', 'number'],
    ['letter_notes', 'string'],
    ['applied_at', 'string'],
    // этап 5: когда отправлена карточка (W2) — по нему W6 помечает «⌛ устарела» через 3 дня
    ['card_at', 'string'],
    // 07.10.2026: защита от двойного ✅ (W3 ставит перед вызовом W5) и версия промпта оценки (W2)
    ['letter_lock', 'string'],
    ['prompt_v', 'string'],
  ],
  // Чёрный список компаний — заполняет пользователь в UI n8n.
  // company: кусок названия компании или её id на hh (только цифры)
  blacklist: [
    ['company', 'string'],
    ['comment', 'string'],
  ],
  // Настройки из бота (⚙️, 07.10.2026): только изменения пользователя, значения по умолчанию — в коде.
  // value — JSON. Имена колонок обходят служебные слова SQL (key, value)
  settings: [
    ['name', 'string'],
    ['value_json', 'string'],
  ],
  // Журнал сборов W1: блокировка параллельных сборов, статистика W6 и W7 (07.10.2026)
  runs: [
    ['started_at', 'string'],
    ['finished_at', 'string'],
    ['kind', 'string'], // schedule | catchup | bot | manual
    ['status', 'string'], // running | ok | error
    ['found', 'number'], // hh нашёл всего (totalResults)
    ['uniq', 'number'], // без дублей
    ['fresh', 'number'], // новых
    ['rejected', 'number'], // отсеяно фильтром
    ['scoring', 'number'], // ушло на оценку
    ['pages', 'number'], // открыто страниц вакансий
    ['cards', 'number'], // карточек отправил W2
    ['error', 'string'],
  ],
  // Тревоги W4: одна на проблему, повторы — счётчик в той же тревоге (07.10.2026)
  alerts: [
    ['alert_key', 'string'],
    ['workflow', 'string'],
    ['message', 'string'],
    ['first_at', 'string'],
    ['last_at', 'string'],
    ['hits', 'number'],
    ['is_open', 'boolean'],
    ['tg_message_id', 'number'],
  ],
};
