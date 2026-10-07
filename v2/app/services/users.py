"""Пользователи: поиск, создание по инвайту или заявке, часовой пояс, блокировка, первый администратор."""

from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Profile, User

PAGE = 8


async def get_by_tg(session: AsyncSession, tg_id: int) -> User | None:
    return await session.scalar(select(User).where(User.tg_id == tg_id))


async def get(session: AsyncSession, user_id: int) -> User | None:
    return await session.get(User, user_id)


async def ensure_admin(session: AsyncSession, tg_id: int, username: str | None, first_name: str | None) -> User:
    """Администратор из .env заводится сам при первом обращении (без инвайта)."""
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


async def create(
    session: AsyncSession,
    tg_id: int,
    username: str | None,
    first_name: str | None,
    invited_by: int | None,
    invite_id: int | None = None,
) -> User | None:
    """Новый пользователь; уже есть с таким tg_id — None (вызывающий решает, что делать). Без commit."""
    stmt = (
        insert(User)
        .values(tg_id=tg_id, username=username, first_name=first_name, invited_by=invited_by, invite_id=invite_id)
        .on_conflict_do_nothing(index_elements=[User.tg_id])
        .returning(User)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def set_tz(session: AsyncSession, user: User, tz: str, now: datetime) -> None:
    user.tz = tz
    if user.onboarded_at is None:
        user.onboarded_at = now
    await session.commit()


async def set_status(session: AsyncSession, user_id: int, status: str) -> User | None:
    """Блок / разблок обычного пользователя. Администратора заблокировать нельзя — None."""
    stmt = (
        update(User)
        .where(User.id == user_id, User.role != "admin")
        .values(status=status)
        .returning(User)
        .execution_options(populate_existing=True)
    )
    user = (await session.execute(stmt)).scalar_one_or_none()
    await session.commit()
    return user


async def admins(session: AsyncSession) -> list[User]:
    return list(await session.scalars(select(User).where(User.role == "admin", User.status == "active")))


async def active_tg_ids(session: AsyncSession) -> list[int]:
    return list(await session.scalars(select(User.tg_id).where(User.status == "active").order_by(User.id)))


async def page(session: AsyncSession, page_no: int) -> tuple[list[tuple[User, int]], int]:
    """Страница списка пользователей (новые сверху) с числом резюме и всего пользователей."""
    total = await session.scalar(select(func.count()).select_from(User)) or 0
    profiles = (
        select(Profile.user_id, func.count().label("n")).group_by(Profile.user_id).subquery()
    )
    rows = await session.execute(
        select(User, func.coalesce(profiles.c.n, 0))
        .outerjoin(profiles, profiles.c.user_id == User.id)
        .order_by(User.id.desc())
        .offset(page_no * PAGE)
        .limit(PAGE)
    )
    return [(u, n) for u, n in rows.all()], total


async def profile_count(session: AsyncSession, user_id: int) -> int:
    return await session.scalar(select(func.count()).select_from(Profile).where(Profile.user_id == user_id)) or 0
