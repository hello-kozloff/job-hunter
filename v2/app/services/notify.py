"""Отправка сообщений из любого процесса ядра (api, бот) — свой экземпляр Bot только для исходящих."""

import logging
from functools import lru_cache

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramAPIError

from app.config import get_settings

log = logging.getLogger(__name__)


@lru_cache
def bot() -> Bot | None:
    token = get_settings().tg_bot_token
    return Bot(token, default=DefaultBotProperties(parse_mode=ParseMode.HTML)) if token else None


async def send(chat_id: int, text: str, **kwargs) -> int | None:
    """message_id или None (бот не настроен, пользователь заблокировал бота и т. п.)."""
    b = bot()
    if b is None:
        return None
    try:
        msg = await b.send_message(chat_id, text, disable_web_page_preview=True, **kwargs)
        return msg.message_id
    except TelegramAPIError as e:
        log.warning("send to %s failed: %s", chat_id, e)
        return None


async def edit(chat_id: int, message_id: int, text: str) -> bool:
    b = bot()
    if b is None:
        return False
    try:
        await b.edit_message_text(text, chat_id=chat_id, message_id=message_id, disable_web_page_preview=True)
        return True
    except TelegramAPIError as e:
        log.info("edit %s/%s failed: %s", chat_id, message_id, e)
        return False
