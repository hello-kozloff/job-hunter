"""Пользователи: поиск по Telegram id, первый администратор из ADMIN_TG_ID."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User


async def get_by_tg(session: AsyncSession, tg_id: int) -> User | None:
    return await session.scalar(select(User).where(User.tg_id == tg_id))


async def ensure_admin(session: AsyncSession, tg_id: int, username: str | None, first_name: str | None) -> User:
    """Администратор из .env заводится сам при первом /start (без инвайта)."""
    stmt = (
        insert(User)
        .values(tg_id=tg_id, username=username, first_name=first_name, role="admin")
        .on_conflict_do_update(
            index_elements=[User.tg_id],
            set_={"role": "admin", "username": username, "first_name": first_name},
        )
        .returning(User)
        # иначе RETURNING отдаст объект из identity map сессии со старыми полями
        .execution_options(populate_existing=True)
    )
    user = (await session.execute(stmt)).scalar_one()
    await session.commit()
    return user
