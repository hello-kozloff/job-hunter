import httpx
import pytest

from app.api.main import app
from app.config import get_settings
from app.db.session import session_scope


@pytest.fixture
async def client(session):
    async def override():
        yield session

    app.dependency_overrides[session_scope] = override
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_health(client) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_internal_requires_token(client, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "internal_token", "secret")
    assert (await client.get("/internal/ping")).status_code == 401
    assert (await client.get("/internal/ping", headers={"X-Internal-Token": "wrong"})).status_code == 401
    assert (await client.get("/internal/ping", headers={"X-Internal-Token": "secret"})).status_code == 200


async def test_internal_closed_without_configured_token(client, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "internal_token", "")
    assert (await client.get("/internal/ping", headers={"X-Internal-Token": ""})).status_code == 401
