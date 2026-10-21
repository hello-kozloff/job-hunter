// Настройки сервиса из environment контейнера (docker-compose.yml ← .env). Описание — docs/claude-cli.md.
export const config = {
  version: '1.0.0',
  port: Number(process.env.PORT ?? 3000),
  // Токен подписки на год: claude setup-token (только своя подписка Pro/Max). Нет токена — CLI не запускаем,
  // вызовы сразу уходят в запасной Gemini
  token: String(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '').trim(),
  // Запасной Gemini — тот же ключ, что у n8n (.env). Нет ключа — перехода нет, n8n получит ошибку Claude
  geminiKey: String(process.env.GEMINI_API_KEY ?? '').trim(),
  // Бесплатный Gemini — 10–15 запросов в минуту: старты запасных вызовов не чаще раза в 6,5 с
  geminiIntervalMs: Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 6500),
  // Оценка вакансий (W2) не берёт подписку, если окно лимита (5 ч или неделя) занято на эту долю и больше: твоя
  // работа в Claude Code важнее сбора. Письма и резюме — до настоящего лимита
  scoreMaxUtil: Number(process.env.CLAUDE_CLI_SCORE_MAX_UTIL ?? 0.8),
  // Время сброса лимита CLI пишет по поясу контейнера (TZ = USER_TZ из .env)
  timezone: process.env.TZ || 'Europe/Moscow',
  // Рабочая папка claude: пустая — ни CLAUDE.md, ни настроек проекта
  workDir: process.env.CLAUDE_CLI_WORKDIR || '/work',
  // Свой CLAUDE_CONFIG_DIR на вызов (tmpfs): параллельные процессы не пишут один ~/.claude.json
  isolate: process.env.CLAUDE_CLI_ISOLATE !== '0',
};
