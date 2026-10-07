"""Инвайты: ссылка t.me/<бот>?start=i_<код>. Активация атомарна — один UPDATE с условиями."""

import secrets
import string
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Invite, User
from app.services import users

PREFIX = "i_"
_ALPHABET = string.ascii_letters + string.digits


def payload(code: str) -> str:
    return PREFIX + code


def link(bot_username: str, code: str) -> str:
    return f"https://t.me/{bot_username}?start={payload(code)}"


def code_from_payload(start_payload: str | None) -> str | None:
    if start_payload and start_payload.startswith(PREFIX) and len(start_payload) > len(PREFIX):
        return start_payload[len(PREFIX) :]
    return None


async def create(
    session: AsyncSession, created_by: int, max_uses: int, days: int | None, now: datetime, comment: str | None = None
) -> Invite:
    invite = Invite(
        code="".join(secrets.choice(_ALPHABET) for _ in range(12)),
        created_by=created_by,
        max_uses=max_uses,
        expires_at=now + timedelta(days=days) if days else None,
        comment=comment,
    )
    session.add(invite)
    await session.commit()
    return invite


async def active(session: AsyncSession, now: datetime) -> list[Invite]:
    return list(
        await session.scalars(
            select(Invite)
            .where(
                Invite.revoked.is_(False),
                Invite.used < Invite.max_uses,
                or_(Invite.expires_at.is_(None), Invite.expires_at > now),
            )
            .order_by(Invite.id.desc())
        )
    )


async def revoke(session: AsyncSession, invite_id: int) -> bool:
    result = await session.execute(update(Invite).where(Invite.id == invite_id).values(revoked=True).returning(Invite.id))
    await session.commit()
    return result.scalar_one_or_none() is not None


@dataclass
class Redeemed:
    user: User
    invite: Invite


async def redeem(
    session: AsyncSession, code: str, tg_id: int, username: str | None, first_name: str | None, now: datetime
) -> Redeemed | None:
    """Активировать инвайт и завести пользователя одной транзакцией.

    None — код не найден, отозван, исчерпан или истёк, либо пользователь уже есть (тогда активация не тратится).
    """
    if await users.get_by_tg(session, tg_id) is not None:
        return None
    invite = (
        await session.execute(
            update(Invite)
            .where(
                Invite.code == code,
                Invite.revoked.is_(False),
                Invite.used < Invite.max_uses,
                or_(Invite.expires_at.is_(None), Invite.expires_at > now),
            )
            .values(used=Invite.used + 1)
            .returning(Invite)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if invite is None:
        # UPDATE ничего не изменил — откатывать нечего (rollback «протушил» бы объекты сессии)
        return None
    user = await users.create(session, tg_id, username, first_name, invited_by=invite.created_by, invite_id=invite.id)
    if user is None:
        # Параллельный /start того же человека успел первым — активацию не тратим
        await session.rollback()
        return None
    await session.commit()
    return Redeemed(user=user, invite=invite)
