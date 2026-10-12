#!/usr/bin/env bash
# Симуляция живого отклика (sim/live.mjs): одноразовый контейнер из образа робота БЕЗ СЕТИ, APPLY_LIVE=1, данные —
# во временной папке контейнера. Код — с Mac (src и sim только для чтения): образ пересобирать не нужно, нужен лишь
# сам образ job-hunter-applier (scripts/deploy.sh --applier). Аргумент — часть имени сценария (sim/run.sh quick).
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker run --rm --init --network none --shm-size=1g \
  -v "$PWD/src:/app/src:ro" -v "$PWD/sim:/app/sim:ro" \
  -e DATA_DIR=/tmp/sim -e APPLY_LIVE=1 -e APPLIER_FAKE=0 \
  --entrypoint bash job-hunter-applier -c '
    Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
    for _ in $(seq 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
    node /app/sim/live.mjs "$@" 2>&1 | grep -v "^{\"at\""
  ' sim "$@"
