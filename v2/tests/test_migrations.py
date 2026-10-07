"""Миграции совпадают с моделями и откатываются."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from app.db.models import Base
from tests.conftest import alembic


async def test_models_match_migrations(engine) -> None:
    def diff(sync_conn):
        ctx = MigrationContext.configure(sync_conn, opts={"compare_type": True})
        return compare_metadata(ctx, Base.metadata)

    async with engine.connect() as conn:
        changes = await conn.run_sync(diff)
    assert changes == [], f"модели расходятся с миграциями — нужен alembic revision --autogenerate: {changes}"


def test_downgrade_and_upgrade_again(migrated: str) -> None:
    alembic("downgrade", "base")
    alembic("upgrade", "head")
