#!/usr/bin/env bash
# Собрать workflow из n8n/**/*.js и залить в локальный n8n (docker compose). Сам деплой — scripts/deploy.mjs
# (Node, работает и без bash); здесь — проверки git flow владельца репозитория.
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
# Что публикуется и почему, туннель, credentials — в scripts/lib/deploy.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."

ANY_BRANCH=false
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --paused) ARGS+=("$arg") ;;
    --any-branch) ANY_BRANCH=true ;;
    --applier) ARGS+=("$arg") ;;
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

exec node scripts/deploy.mjs "${ARGS[@]+"${ARGS[@]}"}"
