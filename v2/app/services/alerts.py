"""Тревоги администратору (как W4 v1): новая — сообщение со звуком; повтор того же ключа в течение 6 ч —
правка открытой тревоги «🔁 ×N»; resolve — «✅ снова работает».

Ключ — источник + текст без чисел и ссылок: одна и та же поломка с разными id не плодит тревоги.
"""

import html
import re
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Alert
from app.services import notify

REPEAT_WINDOW = timedelta(hours=6)


def make_key(source: str, message: str) -> str:
    text = re.sub(r"https?://\S+", "<url>", message)
    text = re.sub(r"\d+", "N", text)
    return f"{source}|{text}"[:256]


def _text(a: Alert) -> str:
    head = f"🚨 <b>{html.escape(a.source)}</b>\n{html.escape(a.message)[:1500]}"
    if a.hits > 1:
        head += f"\n\n🔁 ×{a.hits}, с {a.first_at:%d.%m %H:%M} до {a.last_at:%H:%M} UTC"
    return head


async def raise_alert(session: AsyncSession, source: str, message: str, now: datetime) -> Alert:
    key = make_key(source, message)
    alert = await session.scalar(
        select(Alert).where(Alert.alert_key == key, Alert.is_open.is_(True)).order_by(Alert.id.desc()).limit(1)
    )
    admin = get_settings().admin_tg_id
    if alert is not None and now - alert.last_at < REPEAT_WINDOW:
        alert.hits += 1
        alert.last_at = now
        alert.message = message
        await session.commit()
        if admin and alert.tg_message_id:
            await notify.edit(admin, alert.tg_message_id, _text(alert))
        return alert
    alert = Alert(alert_key=key, source=source, message=message, first_at=now, last_at=now)
    session.add(alert)
    await session.flush()
    if admin:
        alert.tg_message_id = await notify.send(admin, _text(alert))
    await session.commit()
    return alert


async def resolve(session: AsyncSession, source_prefix: str) -> int:
    """Закрыть открытые тревоги источника; админу — «✅ снова работает» по каждой."""
    open_alerts = list(
        await session.scalars(select(Alert).where(Alert.is_open.is_(True), Alert.source.startswith(source_prefix)))
    )
    admin = get_settings().admin_tg_id
    for a in open_alerts:
        a.is_open = False
        if admin:
            await notify.send(admin, f"✅ <b>{html.escape(a.source)}</b> снова работает", disable_notification=True)
    await session.commit()
    return len(open_alerts)
