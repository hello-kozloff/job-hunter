// Настройки робота из environment контейнера (docker-compose.yml ← .env).
export const config = {
  version: '6.0.0',
  port: Number(process.env.PORT ?? 3000),
  // Без токена сервер не стартует: API робота — это доступ к аккаунту hh (server.mjs)
  token: String(process.env.APPLIER_TOKEN ?? ''),
  // Предохранитель: без APPLY_LIVE=1 робот не нажимает «Откликнуться» вообще (сухой прогон до кнопки)
  live: process.env.APPLY_LIVE === '1',
  // Фейковый режим (этап 6.1a): браузер не запускается, исходы — по команде, для проверки n8n без hh
  fake: process.env.APPLIER_FAKE === '1',
  // Жёсткий потолок живых откликов в «день» робота — сверх лимита из настроек бота (защита от ошибки в n8n)
  dailyCap: Number(process.env.APPLIER_DAILY_CAP ?? 40) || 40,
  // Название резюме на hh для сверки в окне отклика (по желанию: у пользователя одно резюме)
  resumeTitle: String(process.env.HH_RESUME_TITLE ?? '').trim(),
  dataDir: process.env.DATA_DIR ?? '/data',
  // Браузер «живёт» там же, где пользователь и его IP
  timezone: 'Asia/Bangkok',
  locale: 'ru-RU',
};
