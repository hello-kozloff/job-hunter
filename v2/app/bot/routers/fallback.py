"""Последний роутер: всё, что не поймали остальные."""

from aiogram import Router
from aiogram.types import CallbackQuery, Message

from app.bot.texts import t
from app.db.models import User

router = Router(name="fallback")


@router.message()
async def unknown_message(message: Message, user: User | None) -> None:
    if user is None or user.status != "active":
        await message.answer(t("not_member"))
    else:
        await message.answer(t("unknown"))


@router.callback_query()
async def unknown_button(query: CallbackQuery) -> None:
    await query.answer(t("stale"))
