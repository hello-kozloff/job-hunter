#!/usr/bin/env bash
# Запуск робота: виртуальный экран → оконный менеджер → VNC (пароль VNC_PASSWORD) → HTTP API (node).
# Окно робота видно с Mac через «Общий экран»: vnc://localhost:5901 (порт 5900 контейнера → 127.0.0.1:5901).
set -euo pipefail

mkdir -p /data/profile /data/shots /data/logs
# После жёсткой остановки профиль держит замки — Chromium с ними не стартует
rm -f /data/profile/SingletonLock /data/profile/SingletonSocket /data/profile/SingletonCookie /tmp/.X99-lock

Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
for _ in $(seq 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
fluxbox >/tmp/fluxbox.log 2>&1 &

if [ -n "${VNC_PASSWORD:-}" ]; then
  # Пароль VNC — не длиннее 8 символов (ограничение протокола), x11vnc обрезает остальное
  x11vnc -storepasswd "$VNC_PASSWORD" /tmp/vncpass >/dev/null 2>&1
  x11vnc -display :99 -rfbport 5900 -rfbauth /tmp/vncpass -forever -shared -noxdamage -quiet >/tmp/x11vnc.log 2>&1 &
else
  echo '{"event":"vnc.off","note":"VNC_PASSWORD не задан — окно робота не видно"}'
fi

exec node /app/src/server.mjs
