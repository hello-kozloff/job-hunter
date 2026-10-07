"""REST ядра v2: /health (докер, деплой) и /internal/* (n8n v2, заголовок X-Internal-Token)."""

from fastapi import FastAPI

from app.api import health, internal

app = FastAPI(title="Job Hunter v2", docs_url=None, redoc_url=None)
app.include_router(health.router)
app.include_router(internal.router)
