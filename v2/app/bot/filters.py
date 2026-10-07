"""Фильтры доступа: участник (активный пользователь) и администратор."""

from aiogram.filters import Filter
from aiogram.types import TelegramObject

from app.db.models import User


class IsMember(Filter):
    async def __call__(self, event: TelegramObject, user: User | None) -> bool:
        return user is not None and user.status == "active"


class IsAdmin(Filter):
    async def __call__(self, event: TelegramObject, user: User | None) -> bool:
        return user is not None and user.status == "active" and user.role == "admin"
