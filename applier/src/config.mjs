// Настройки робота из environment контейнера (docker-compose.yml ← .env).
export const config = {
  version: '6.2.0',
  port: Number(process.env.PORT ?? 3000),
  // Без токена сервер не стартует: API робота — это доступ к аккаунту hh (server.mjs)
  token: String(process.env.APPLIER_TOKEN ?? ''),
  // Предохранитель: без APPLY_LIVE=1 робот не нажимает «Откликнуться» вообще (сухой прогон до кнопки)
  live: process.env.APPLY_LIVE === '1',
  // Предохранитель резюме (часть D): без RESUME_LIVE=1 робот резюме на hh не сохраняет — только сухой прогон
  // (заполнить формы, снимки, уйти без сохранения)
  resumeLive: process.env.RESUME_LIVE === '1',
  // Фейковый режим (этап 6.1a): браузер не запускается, исходы — по команде, для проверки n8n без hh
  fake: process.env.APPLIER_FAKE === '1',
  // Жёсткий потолок живых откликов в «день» робота — сверх лимита из настроек бота (защита от ошибки в n8n)
  dailyCap: Number(process.env.APPLIER_DAILY_CAP ?? 100) || 100,
  // Темп (автоотклик, 20.10.2026): потолок живых откликов за час и нижняя граница паузы между попытками (секунды) —
  // сверх темпа из настроек бота, который присылает W9 (src/pace.mjs)
  hourlyCap: Number(process.env.APPLIER_HOURLY_CAP ?? 40) || 40,
  minGap: Number(process.env.APPLIER_MIN_GAP ?? 15) || 15,
  // Название резюме на hh для сверки в окне отклика (по желанию: у пользователя одно резюме)
  resumeTitle: String(process.env.HH_RESUME_TITLE ?? '').trim(),
  dataDir: process.env.DATA_DIR ?? '/data',
  // Браузер «живёт» там же, где пользователь и его IP: пояс компьютера (USER_TZ пишет мастер установки)
  timezone: process.env.USER_TZ || 'Europe/Moscow',
  locale: 'ru-RU',
};
