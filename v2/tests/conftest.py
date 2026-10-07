"""Тесты ядра идут в контейнере против базы hunter_test (создаёт postgres/init.sh).

Запуск: v2/scripts/test.sh  (= docker compose run --rm api pytest)
"""

import os
import subprocess

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

TEST_URL = os.environ.get("TEST_DATABASE_URL") or os.environ["DATABASE_URL"].rsplit("/", 1)[0] + "/hunter_test"


def alembic(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["alembic", "-x", f"url={TEST_URL}", *args], capture_output=True, text=True, check=True
    )


@pytest.fixture(scope="session")
def migrated() -> str:
    alembic("downgrade", "base")
    alembic("upgrade", "head")
    return TEST_URL


@pytest.fixture(scope="session")
async def engine(migrated: str):
    engine = create_async_engine(migrated)
    yield engine
    await engine.dispose()


@pytest.fixture
async def session(engine):
    """Сессия на тест; всё, что тест записал, откатывается."""
    async with engine.connect() as conn:
        trans = await conn.begin()
        maker = async_sessionmaker(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint")
        async with maker() as s:
            yield s
        await trans.rollback()


@pytest.fixture(autouse=True)
def no_outside_world(monkeypatch):
    """В контейнере тестов настоящие TG_BOT_TOKEN и GEMINI_API_KEY из v2/.env — ничего наружу не шлём.

    Отправленные сообщения копятся в sent: [(chat_id, text)].
    """
    from app.services import llm, notify

    sent: list[tuple[int, str]] = []

    async def send(chat_id, text, **kw):
        sent.append((chat_id, text))
        return len(sent)

    async def edit(chat_id, message_id, text):
        sent.append((chat_id, text))
        return True

    async def no_llm(*a, **kw):
        raise AssertionError("тест полез в настоящую нейросеть — подмени llm.ask")

    monkeypatch.setattr(notify, "send", send)
    monkeypatch.setattr(notify, "edit", edit)
    monkeypatch.setattr(llm, "_gemini", no_llm)
    monkeypatch.setattr(llm, "_claude", no_llm)
    return sent
