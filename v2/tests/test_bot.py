"""Бот собирается, фильтры доступа пускают кого надо."""

from app.bot import main  # noqa: F401 — импорт всех роутеров ловит ошибки сборки
from app.bot.filters import IsAdmin, IsMember
from app.db.models import User


async def test_filters() -> None:
    admin = User(tg_id=1, role="admin", status="active")
    member = User(tg_id=2, role="user", status="active")
    blocked = User(tg_id=3, role="user", status="blocked")
    blocked_admin = User(tg_id=4, role="admin", status="blocked")
    assert [await IsMember()(None, u) for u in (admin, member, blocked, None)] == [True, True, False, False]
    assert [await IsAdmin()(None, u) for u in (admin, member, blocked_admin, None)] == [True, False, False, False]
