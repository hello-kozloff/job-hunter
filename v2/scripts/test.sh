#!/usr/bin/env bash
# Тесты ядра v2 в контейнере (локально Python/uv не нужны): база hunter_test в Postgres v2.
#   v2/scripts/test.sh            все тесты
#   v2/scripts/test.sh -k health  аргументы pytest
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose build -q api
docker compose up -d --wait postgres
docker compose run --rm --no-deps -v "$PWD/tests:/app/tests:ro" api pytest -q "$@"
