# Образ ядра v2: api и bot (разные команды в docker-compose.yml). uv ставит зависимости по uv.lock.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/venv \
    PATH="/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen
COPY . .
