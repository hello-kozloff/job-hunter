# Claude по подписке (docs/claude-cli.md): официальный Claude Code CLI без инструментов + HTTP API для n8n.
# Версия CLI закреплена: новая версия — сначала разведка (docs/claude-cli.md → «Обновление CLI»), потом деплой
FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.303
ENV NODE_ENV=production \
    DISABLE_AUTOUPDATER=1 \
    DISABLE_UPDATES=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# npm ставит тот же нативный бинарник, что и установщик Anthropic (сборка linux-arm64 / x64)
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && npm cache clean --force && claude --version

WORKDIR /app
COPY package.json ./
COPY src ./src
# Пустая рабочая папка claude: ни CLAUDE.md, ни настроек проекта
RUN mkdir -p /work && chown node:node /work

USER node
EXPOSE 3000
CMD ["node", "src/server.mjs"]
