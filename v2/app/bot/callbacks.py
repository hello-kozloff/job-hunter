"""callback_data кнопок (лимит Telegram — 64 байта). Префиксы уникальны на весь бот."""

from aiogram.filters.callback_data import CallbackData


class RequestAccess(CallbackData, prefix="req"):
    pass


class Tz(CallbackData, prefix="tz"):
    # Индекс в timezones.POPULAR; -1 — «✏️ Другой»
    i: int


class Decide(CallbackData, prefix="ar"):
    """Решение админа по заявке на доступ."""

    id: int
    ok: bool


class Admin(CallbackData, prefix="adm"):
    """Панель администратора: action — экран или действие, arg — параметр (номер страницы, id, …)."""

    action: str
    arg: str = ""
