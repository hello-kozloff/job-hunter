// Модели, которые сервис запускает: только полные ID — алиасы (haiku, sonnet, default) со временем указывают на
// другие модели, а теневому режиму нужна точная. Fable нет: на Pro в -p она молча списывает платные кредиты.
// Семейство — для лимитов на одну линейку («You've hit your Sonnet limit»): лимит Sonnet не останавливает Haiku
export const MODELS = {
  'claude-haiku-5-5': 'haiku',
  'claude-sonnet-5-5': 'sonnet',
  'claude-opus-5-5': 'opus',
};
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const familyOf = (model) => MODELS[model] ?? null;
