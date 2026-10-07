"""Сессия базы и пользователь в каждом обработчике (data["session"], data["user"])."""

from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject
from aiogram.types import User as TgUser

from app.config import get_settings
from app.db.session import get_sessionmaker
from app.services import users


class DbUserMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        tg: TgUser | None = data.get("event_from_user")
        async with get_sessionmaker()() as session:
            user = None
            if tg is not None:
                user = await users.get_by_tg(session, tg.id)
                if tg.id == get_settings().admin_tg_id and (user is None or user.role != "admin"):
                    # Администратор из .env заводится и получает роль сам
                    user = await users.ensure_admin(session, tg.id, tg.username, tg.first_name)
            data["session"] = session
            data["user"] = user
            return await handler(event, data)
