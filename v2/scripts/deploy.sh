#!/usr/bin/env bash
# Деплой v2: образ ядра → Postgres → миграции → api, bot, n8n v2.
# v1 не затрагивается: другой compose project (job-hunter-v2), свои контейнеры, порты и база.
#
#   v2/scripts/deploy.sh               с develop или production (docs/git-flow.md)
#   v2/scripts/deploy.sh --any-branch  осознанно с другой ветки
set -euo pipefail
cd "$(dirname "$0")/.."

ANY_BRANCH=false
for arg in "$@"; do
  case "$arg" in
    --any-branch) ANY_BRANCH=true ;;
    *)
      echo "Неизвестный флаг: $arg" >&2
      exit 2
      ;;
  esac
done

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != develop && "$BRANCH" != production && "$ANY_BRANCH" != true ]]; then
  echo "Деплой v2 с ветки «${BRANCH}» не по git flow: только develop или production (docs/git-flow.md)." >&2
  echo "Осознанно с этой ветки — v2/scripts/deploy.sh --any-branch" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no -- .)" ]]; then
  echo "⚠️  Есть незакоммиченные изменения в v2/ — в работу уйдёт код, которого нет в git" >&2
fi
if [[ ! -f .env ]]; then
  echo "Нет v2/.env — скопируй v2/.env.example и заполни (chmod 600)" >&2
  exit 1
fi

docker compose build -q
docker compose up -d --wait postgres
docker compose run --rm --no-deps api alembic upgrade head
docker compose up -d --wait --remove-orphans
docker compose ps --format 'table {{.Name}}\t{{.Status}}'

if ! grep -q '^TG_BOT_TOKEN=..*' .env; then
  echo "ℹ️  TG_BOT_TOKEN пуст — бот v2 ждёт токен: создай НОВОГО бота в @BotFather, впиши в v2/.env и снова deploy" >&2
fi
