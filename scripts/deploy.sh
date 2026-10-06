#!/usr/bin/env bash
# Собрать workflow из n8n/**/*.js и залить в локальный n8n (docker compose).
#
#   scripts/deploy.sh            импорт всех workflow; расписания W1/W2 остаются выключенными
#   scripts/deploy.sh --publish  то же + публикация W1 и W2 (расписания включены; W2 — если в .env есть ключ нейросети)
#
# Импорт снимает публикацию со всех workflow, поэтому:
#   - W4 (тревоги) публикуется всегда — в n8n 2.42 неопубликованный Error workflow не запускается;
#   - W3 (кнопки Telegram) публикуется всегда, если настроен туннель (NGROK_DOMAIN в .env):
#     при публикации n8n регистрирует вебхук бота https://<NGROK_DOMAIN>/webhook/…;
#   - после изменений в W1/W2 деплоить с --publish.
# Публикацию из CLI запущенный n8n видит только после перезапуска — в конце n8n перезапускается.
#
# Credentials (Telegram, Gemini, Claude) создаются/обновляются из ключей в .env — см. scripts/credentials.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=job-hunter-n8n
WORKFLOWS_TO_PUBLISH=(jobHunterW4Error)
if [[ "${1:-}" == "--publish" ]]; then
  WORKFLOWS_TO_PUBLISH+=(jobHunterW1Colle)
  # W2 без ключа нейросети каждый запуск слал бы тревогу — публикуем, когда ключ есть
  if grep -qE '^(GEMINI_API_KEY|ANTHROPIC_API_KEY)=..*' .env 2>/dev/null; then
    WORKFLOWS_TO_PUBLISH+=(jobHunterW2Score)
  fi
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
