"""Общие куски сообщений: подпись человека, клавиатура выбора пояса."""

import html

from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from app.bot.callbacks import Tz
from app.bot.texts import t
from app.domain import timezones


def who(tg_id: int, username: str | None, first_name: str | None) -> str:
    """«Никита (@nik)» со ссылкой на профиль; всё пользовательское экранировано."""
    name = html.escape(first_name or "без имени")
    tail = f" (@{html.escape(username)})" if username else ""
    return f'<a href="tg://user?id={tg_id}">{name}</a>{tail}'


def tz_keyboard() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for i, (label, _) in enumerate(timezones.POPULAR):
        kb.button(text=label, callback_data=Tz(i=i))
    kb.button(text=t("tz.btn_other"), callback_data=Tz(i=-1))
    kb.adjust(3)
    return kb.as_markup()
