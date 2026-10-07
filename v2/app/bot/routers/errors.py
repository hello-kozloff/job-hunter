"""Любое исключение в обработчике: пользователю — «ошибка» вместо молчащей кнопки, администраторам — текст ошибки."""

import html
import logging

from aiogram import Bot, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.types import ErrorEvent

from app.bot.texts import t
from app.config import get_settings

log = logging.getLogger(__name__)
router = Router(name="errors")


@router.errors()
async def on_error(event: ErrorEvent, bot: Bot) -> bool:
    log.exception("update %s failed", event.update.update_id, exc_info=event.exception)
    update = event.update
    try:
        if update.callback_query:
            await update.callback_query.answer(t("error"), show_alert=True)
        elif update.message:
            await update.message.answer(t("error"))
    except TelegramAPIError:
        pass
    admin_id = get_settings().admin_tg_id
    if admin_id:
        text = t("error.admin", kind=type(event.exception).__name__, message=html.escape(str(event.exception))[:500])
        try:
            await bot.send_message(admin_id, text)
        except TelegramAPIError:
            pass
    return True
