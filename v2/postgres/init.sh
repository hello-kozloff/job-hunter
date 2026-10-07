#!/bin/sh
# Первый старт Postgres: роль и база n8n v2, база для тестов ядра.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE n8n LOGIN PASSWORD '${N8N_DB_PASSWORD}';
CREATE DATABASE n8n OWNER n8n;
CREATE DATABASE hunter_test OWNER hunter;
SQL
