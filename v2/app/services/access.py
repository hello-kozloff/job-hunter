"""Заявки на доступ от тех, у кого нет инвайта. Одна открытая заявка на человека."""

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AccessRequest, User
from app.services import users


async def request(
    session: AsyncSession, tg_id: int, username: str | None, first_name: str | None
) -> tuple[AccessRequest, bool]:
    """Заявка и признак «новая». Открытая уже есть — её же, без повторного уведомления админа."""
    existing = await session.scalar(
        select(AccessRequest).where(AccessRequest.tg_id == tg_id, AccessRequest.status == "pending")
    )
    if existing is not None:
        return existing, False
    req = AccessRequest(tg_id=tg_id, username=username, first_name=first_name)
    session.add(req)
    await session.commit()
    return req, True


async def pending(session: AsyncSession) -> list[AccessRequest]:
    return list(
        await session.scalars(
            select(AccessRequest).where(AccessRequest.status == "pending").order_by(AccessRequest.id)
        )
    )


async def decide(
    session: AsyncSession, request_id: int, approve: bool, admin: User, now: datetime
) -> tuple[AccessRequest, User | None] | None:
    """Одобрить или отклонить открытую заявку. None — заявка уже решена (второе нажатие, другой админ).

    Одобрение заводит пользователя (invited_by — админ). Пользователь уже есть — заявка просто закрывается.
    """
    req = (
        await session.execute(
            update(AccessRequest)
            .where(AccessRequest.id == request_id, AccessRequest.status == "pending")
            .values(status="approved" if approve else "rejected", decided_by=admin.id, decided_at=now)
            .returning(AccessRequest)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if req is None:
        # UPDATE ничего не изменил — откатывать нечего (rollback «протушил» бы объекты сессии)
        return None
    user = None
    if approve:
        user = await users.create(session, req.tg_id, req.username, req.first_name, invited_by=admin.id)
    await session.commit()
    return req, user
