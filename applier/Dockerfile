# Робот-отклик (этап 6): Playwright + Chromium с окном в виртуальном экране (Xvfb), VNC для входа в hh.
# Версия образа = версия playwright-core в package.json: браузер берётся из образа, npm его не качает.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    TZ=Asia/Bangkok \
    LANG=ru_RU.UTF-8 \
    NODE_ENV=production \
    DATA_DIR=/data

# Виртуальный экран, VNC-сервер, оконный менеджер, русская локаль (шрифты с кириллицей уже в образе)
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb x11vnc fluxbox locales tzdata \
 && sed -i 's/# ru_RU.UTF-8/ru_RU.UTF-8/' /etc/locale.gen && locale-gen \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY entrypoint.sh /entrypoint.sh
# Том /data (профиль браузера, сессия, скриншоты, журналы) создаётся с владельцем из образа
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown pwuser:pwuser /data

USER pwuser
EXPOSE 3000 5900
ENTRYPOINT ["/entrypoint.sh"]
