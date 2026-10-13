#!/usr/bin/env bash
# Собрать workflow из n8n/**/*.js и залить в локальный n8n (docker compose).
#
#   scripts/deploy.sh               импорт всех workflow + публикация рабочих (расписания включены)
#   scripts/deploy.sh --paused      то же, но W8 Clock и W6 остаются выключенными (сбор и сводка не работают;
#                                   паузу без деплоя ставит бот: ⚙️ Настройки → 🕐 Сбор → ⏸)
#   scripts/deploy.sh --any-branch  деплой не с develop / production (осознанно, в обход git flow)
#   scripts/deploy.sh --applier     ещё и пересобрать и перезапустить робота-отклика (этап 6): сначала ждёт, пока
#                                   робот закончит текущее действие. Без флага робот не трогается — отклик не оборвётся.
#                                   Смена APPLY_LIVE / APPLIER_FAKE / VNC_PASSWORD в .env — тоже через --applier
#   (--publish — прежнее название обычного деплоя, работает как без флага)
#
# Git flow (docs/git-flow.md): в n8n уходит develop (проверка на живых запусках) или production (hotfix, откат).
#
# Импорт снимает публикацию со всех workflow, поэтому после него публикуются заново:
#   - W4 (тревоги), W5 (письма), W7 (меню бота), W1 (сбор) и W2 (оценка) — всегда: в n8n 2.42 неопубликованный
#     Error workflow и неопубликованный дочерний workflow (Execute Workflow) не запускаются;
#   - W8 Clock («часы» сбора и сводки) и W6 (сводка, её запускает W8) — если нет --paused;
#   - W3 (кнопки Telegram) — если настроен туннель (NGROK_DOMAIN в .env):
#     при публикации n8n регистрирует вебхук бота https://<NGROK_DOMAIN>/webhook/….
# Публикацию из CLI запущенный n8n видит только после перезапуска — в конце n8n перезапускается.
#
# Credentials (Telegram, Gemini, Claude, healthchecks) создаются/обновляются из ключей в .env — см. scripts/credentials.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."

PAUSED=false
ANY_BRANCH=false
APPLIER=false
for arg in "$@"; do
  case "$arg" in
    --paused) PAUSED=true ;;
    --any-branch) ANY_BRANCH=true ;;
    --applier) APPLIER=true ;;
    --publish) ;;
    *)
      echo "Неизвестный флаг: $arg" >&2
      exit 2
      ;;
  esac
done

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != develop && "$BRANCH" != production && "$ANY_BRANCH" != true ]]; then
  echo "Деплой с ветки «${BRANCH}» не по git flow: в n8n уходит develop или production (docs/git-flow.md)." >&2
  echo "Влей ветку через PR в develop и деплой оттуда. Осознанно с этой ветки — scripts/deploy.sh --any-branch" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "⚠️  Есть незакоммиченные изменения — в n8n уйдёт код, которого нет в git" >&2
fi

CONTAINER=job-hunter-n8n
# Вызываемые через Execute Workflow публикуются всегда (в n8n 2.42 вызвать можно только опубликованный):
# W5 (письма) и W7 (меню бота) — из W3, W1 (сбор) — из W8 Clock и W7 («🔄 Собрать сейчас»), W2 — из W1,
# W9 (робот-отклик, этап 6) — из W3 и W7; его расписание раз в минуту безвредно и при --paused: пустая очередь — выход.
# W11 (профиль, онбординг по резюме PDF, 13.10.2026) — из W3.
# Своего расписания у W1 нет (07.10.2026): сбор запускают «часы» W8 — без них (--paused) сборов нет
WORKFLOWS_TO_PUBLISH=(jobHunterW4Error jobHunterW5Lettr jobHunterW7Menu1 jobHunterW1Colle jobHunterW2Score jobHunterW9Robot jobHunterW11Prof)
if [[ "$PAUSED" != true ]]; then
  WORKFLOWS_TO_PUBLISH+=(jobHunterW8Clock jobHunterW6Summ1)
fi
if grep -q '^NGROK_DOMAIN=..*' .env 2>/dev/null; then
  WORKFLOWS_TO_PUBLISH+=(jobHunterW3Teleg)
fi

node scripts/build-workflows.mjs

# Туннель и профили: WEBHOOK_URL и COMPOSE_PROFILES в .env по NGROK_DOMAIN и APPLIER_TOKEN
if grep -qE '^(NGROK_DOMAIN|APPLIER_TOKEN)=..*' .env 2>/dev/null; then
  node scripts/n8n-api.mjs tunnel-env
fi

# Применить изменения docker-compose.yml / .env (переменные, тома, туннель ngrok).
# Сервисы — поимённо: робот-отклик (профиль applier) обычный деплой не пересоздаёт
SERVICES=(n8n)
if grep -q '^NGROK_DOMAIN=..*' .env 2>/dev/null; then
  SERVICES+=(ngrok)
fi
docker compose up -d --wait "${SERVICES[@]}"

# Робот-отклик: дождаться конца текущего действия (до 5 мин), пересобрать образ, пересоздать контейнер
if [[ "$APPLIER" == true ]]; then
  if ! grep -q '^APPLIER_TOKEN=..*' .env 2>/dev/null; then
    echo "Для робота нужен APPLIER_TOKEN в .env (openssl rand -hex 24) — см. .env.example" >&2
    exit 1
  fi
  APPLIER_TOKEN=$(grep '^APPLIER_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d "'\"")
  for _ in $(seq 1 60); do
    busy=$(curl -s -m 5 -H "X-Applier-Token: $APPLIER_TOKEN" http://127.0.0.1:5682/health |
      node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{console.log(JSON.parse(s).busy?"yes":"no")}catch{console.log("no")}})')
    [[ "$busy" == no ]] && break
    echo "Робот занят — жду, пока закончит действие…"
    sleep 5
  done
  docker compose build applier
  docker compose up -d --wait applier
fi

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
