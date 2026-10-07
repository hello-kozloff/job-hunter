"""/start: администратор из .env, вернувшийся пользователь, остальным — «по приглашениям» (инвайты — этап v2.1)."""

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message

from app.bot.texts import t
from app.config import get_settings
from app.db.session import get_sessionmaker
from app.services import users

router = Router(name="start")


@router.message(CommandStart())
async def start(message: Message) -> None:
    sender = message.from_user
    if sender is None:
        return
    async with get_sessionmaker()() as session:
        if sender.id == get_settings().admin_tg_id:
            await users.ensure_admin(session, sender.id, sender.username, sender.first_name)
            await message.answer(t("start.admin"))
            return
        user = await users.get_by_tg(session, sender.id)
    if user is None:
        await message.answer(t("start.closed"))
    elif user.status == "blocked":
        await message.answer(t("start.blocked"))
    else:
        await message.answer(t("start.welcome_back"))
