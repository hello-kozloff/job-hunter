"""Цифры для главного экрана /admin."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AccessRequest, Alert, FetchLog, User
from app.services import invites


@dataclass
class Overview:
    users: int
    blocked: int
    pending: int
    invites: int
    fetches: int
    alerts: int


async def overview(session: AsyncSession, now: datetime) -> Overview:
    async def count(stmt) -> int:
        return await session.scalar(stmt) or 0

    return Overview(
        users=await count(select(func.count()).select_from(User)),
        blocked=await count(select(func.count()).select_from(User).where(User.status == "blocked")),
        pending=await count(select(func.count()).select_from(AccessRequest).where(AccessRequest.status == "pending")),
        invites=len(await invites.active(session, now)),
        fetches=await count(select(func.count()).select_from(FetchLog).where(FetchLog.created_at > now - timedelta(days=1))),
        alerts=await count(select(func.count()).select_from(Alert).where(Alert.is_open.is_(True))),
    )
