#!/usr/bin/env bash
# Собрать workflow из n8n/**/*.js и залить в локальный n8n (docker compose).
#
#   scripts/deploy.sh            импорт всех workflow; W1 остаётся неопубликованным (расписание выключено)
#   scripts/deploy.sh --publish  то же + публикация W1 (расписание включено)
#
# Импорт снимает публикацию со всех workflow, поэтому:
#   - W4 (тревоги) публикуется всегда — в n8n 2.42 неопубликованный Error workflow не запускается;
#   - после изменений в W1 деплоить с --publish.
# Публикацию из CLI запущенный n8n видит только после перезапуска — в конце n8n перезапускается.
#
# Если в .env есть TG_BOT_TOKEN — заодно создаёт/обновляет credential «Telegram bot».
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=job-hunter-n8n
COLLECTOR_ID=jobHunterW1Colle
ERRORS_ID=jobHunterW4Error

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

docker exec "$CONTAINER" n8n publish:workflow --id="$ERRORS_ID"
if [[ "${1:-}" == "--publish" ]]; then
  docker exec "$CONTAINER" n8n publish:workflow --id="$COLLECTOR_ID"
fi

docker compose restart n8n
for _ in $(seq 1 30); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5678/healthz)" == "200" ]] && exit 0
  sleep 2
done
echo "n8n не ответил на /healthz за 60 с" >&2
exit 1
