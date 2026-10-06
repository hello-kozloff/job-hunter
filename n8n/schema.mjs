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
  ],
  // Чёрный список компаний — заполняет пользователь в UI n8n.
  // company: кусок названия компании или её id на hh (только цифры)
  blacklist: [
    ['company', 'string'],
    ['comment', 'string'],
  ],
};
