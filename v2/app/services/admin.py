"""Цифры для главного экрана /admin."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import String, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import AccessRequest, Alert, FetchLog, LlmUsage, Run, SystemState, User
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


@dataclass
class Health:
    runs_ok: int
    runs_error: int
    last_run: Run | None
    fetches: int
    cap: int
    stopped_until: datetime | None
    stop_reason: str
    llm: dict[str, tuple[int, int]]  # kind → (ok, ошибок) за сутки
    llm_top: list[tuple[str, int]]  # пользователь → вызовов за сутки
    to_score: int
    open_alerts: list[Alert]


async def health(session: AsyncSession, now: datetime) -> Health:
    from app.services import collect, score

    day = now - timedelta(days=1)
    runs = dict(
        (await session.execute(
            select(Run.status, func.count()).where(Run.started_at > day).group_by(Run.status)
        )).all()
    )
    llm: dict[str, tuple[int, int]] = {}
    for kind, ok, n in (await session.execute(
        select(LlmUsage.kind, LlmUsage.ok, func.count()).where(LlmUsage.created_at > day).group_by(LlmUsage.kind, LlmUsage.ok)
    )).all():
        good, bad = llm.get(kind, (0, 0))
        llm[kind] = (good + n, bad) if ok else (good, bad + n)
    top = (await session.execute(
        select(func.coalesce(User.first_name, User.username, func.cast(User.tg_id, String)), func.count())
        .select_from(LlmUsage)
        .join(User, User.id == LlmUsage.user_id)
        .where(LlmUsage.created_at > day)
        .group_by(User.id)
        .order_by(func.count().desc())
        .limit(5)
    )).all()
    stop = await session.get(SystemState, collect.STOP_KEY)
    return Health(
        runs_ok=runs.get("ok", 0),
        runs_error=runs.get("error", 0),
        last_run=await session.scalar(select(Run).order_by(Run.id.desc()).limit(1)),
        fetches=await collect.fetches_last_day(session, now),
        cap=get_settings().hh_daily_cap,
        stopped_until=await collect._stopped_until(session, now),
        stop_reason=(stop.value.get("reason", "") if stop else ""),
        llm=llm,
        llm_top=[(name, n) for name, n in top],
        to_score=await score.remaining(session, now),
        open_alerts=list(await session.scalars(select(Alert).where(Alert.is_open.is_(True)).order_by(Alert.id.desc()).limit(5))),
    )
