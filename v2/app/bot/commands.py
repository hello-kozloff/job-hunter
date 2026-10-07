"""Меню команд Telegram: всем — /start, /tz; администратору — ещё /admin."""

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import BotCommand, BotCommandScopeChat, BotCommandScopeDefault

from app.config import get_settings

log = logging.getLogger(__name__)

COMMON = [BotCommand(command="start", description="Главная"), BotCommand(command="tz", description="Часовой пояс")]
ADMIN = [*COMMON, BotCommand(command="admin", description="Администрирование")]


async def set_commands(bot: Bot) -> None:
    """Меню команд: всем — /start, /tz; администратору — ещё /admin (повторно — при его /start)."""
    await bot.set_my_commands(COMMON, scope=BotCommandScopeDefault())
    admin_id = get_settings().admin_tg_id
    if admin_id:
        await set_admin_commands(bot, admin_id)


async def set_admin_commands(bot: Bot, chat_id: int) -> None:
    try:
        await bot.set_my_commands(ADMIN, scope=BotCommandScopeChat(chat_id=chat_id))
    except TelegramBadRequest as e:
        # «chat not found»: администратор ещё не писал этому боту
        log.info("admin commands for %s not set yet: %s", chat_id, e)
