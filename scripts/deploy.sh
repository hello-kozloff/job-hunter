#!/usr/bin/env bash
# Собрать workflow из n8n/**/*.js и залить в локальный n8n (docker compose).
#
#   scripts/deploy.sh            импорт всех workflow (W1 после импорта не опубликован)
#   scripts/deploy.sh --publish  импорт + публикация W1 (включает расписание) + перезапуск n8n
#
# Если в .env есть TG_BOT_TOKEN — заодно создаёт/обновляет credential «Telegram bot».
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=job-hunter-n8n
COLLECTOR_ID=jobHunterW1Colle

node scripts/build-workflows.mjs

# Токен идёт через pipe прямо в контейнер, на диск хоста не попадает
if grep -q '^TG_BOT_TOKEN=..*' .env 2>/dev/null; then
  node scripts/telegram-credential.mjs |
    docker exec -i "$CONTAINER" sh -c 'cat > /tmp/cred.json && n8n import:credentials --input=/tmp/cred.json; rm -f /tmp/cred.json'
fi

# docker cp кладёт файлы от root — удалять тоже от root
docker exec -u root "$CONTAINER" rm -rf /tmp/workflows
docker cp n8n/workflows "$CONTAINER":/tmp/workflows
docker exec "$CONTAINER" n8n import:workflow --separate --input=/tmp/workflows

if [[ "${1:-}" == "--publish" ]]; then
  docker exec "$CONTAINER" n8n publish:workflow --id="$COLLECTOR_ID"
  # Запущенный n8n подхватывает опубликованные из CLI workflow после перезапуска
  docker compose restart n8n
fi
