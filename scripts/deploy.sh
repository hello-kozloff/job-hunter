#!/usr/bin/env bash
# Собрать workflow из n8n/**/*.js и залить в локальный n8n (docker compose).
#
#   scripts/deploy.sh           импорт всех workflow + публикация рабочих (расписания включены)
#   scripts/deploy.sh --paused  то же, но W1, W2 и W6 остаются выключенными (сбор и сводка не работают)
#   (--publish — прежнее название обычного деплоя, работает как без флага)
#
# Импорт снимает публикацию со всех workflow, поэтому после него публикуются заново:
#   - W4 (тревоги) и W5 (письма) — всегда: в n8n 2.42 неопубликованный Error workflow
#     и неопубликованный дочерний workflow (Execute Workflow) не запускаются;
#   - W1 (сбор), W2 (оценка — её вызывает W1) и W6 (сводка) — если нет --paused;
#   - W3 (кнопки Telegram) — если настроен туннель (NGROK_DOMAIN в .env):
#     при публикации n8n регистрирует вебхук бота https://<NGROK_DOMAIN>/webhook/….
# Публикацию из CLI запущенный n8n видит только после перезапуска — в конце n8n перезапускается.
#
# Credentials (Telegram, Gemini, Claude) создаются/обновляются из ключей в .env — см. scripts/credentials.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=job-hunter-n8n
# W5 (письма) вызывается из W3 через Execute Workflow: в n8n 2.42 вызвать можно только опубликованный
WORKFLOWS_TO_PUBLISH=(jobHunterW4Error jobHunterW5Lettr)
if [[ "${1:-}" != "--paused" ]]; then
  # W2 вызывается из W1 тем же способом — публикуется вместе с ним
  WORKFLOWS_TO_PUBLISH+=(jobHunterW1Colle jobHunterW2Score jobHunterW6Summ1)
fi
if grep -q '^NGROK_DOMAIN=..*' .env 2>/dev/null; then
  WORKFLOWS_TO_PUBLISH+=(jobHunterW3Teleg)
fi

node scripts/build-workflows.mjs

# Туннель: WEBHOOK_URL и COMPOSE_PROFILES в .env по NGROK_DOMAIN
if grep -q '^NGROK_DOMAIN=..*' .env 2>/dev/null; then
  node scripts/n8n-api.mjs tunnel-env
fi

# Применить изменения docker-compose.yml / .env (переменные, тома, туннель ngrok)
docker compose up -d --wait

# Ключи идут через pipe прямо в контейнер, на диск хоста не попадают
node scripts/credentials.mjs |
  docker exec -i "$CONTAINER" sh -c 'cat > /tmp/cred.json && n8n import:credentials --input=/tmp/cred.json; rm -f /tmp/cred.json'

# docker cp кладёт файлы от root — удалять тоже от root
docker exec -u root "$CONTAINER" rm -rf /tmp/workflows
docker cp n8n/workflows "$CONTAINER":/tmp/workflows
docker exec "$CONTAINER" n8n import:workflow --separate --input=/tmp/workflows

for id in "${WORKFLOWS_TO_PUBLISH[@]}"; do
  docker exec "$CONTAINER" n8n publish:workflow --id="$id"
done

docker compose restart n8n
for _ in $(seq 1 30); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5678/healthz)" == "200" ]] && exit 0
  sleep 2
done
echo "n8n не ответил на /healthz за 60 с" >&2
exit 1
