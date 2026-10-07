"""Онбординг и /tz: часовой пояс кнопкой или текстом. Первый выбор пояса завершает онбординг."""

import html
from datetime import UTC, datetime

from aiogram import F, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.callbacks import Tz
from app.bot.filters import IsMember
from app.bot.texts import t
from app.bot.views import tz_keyboard
from app.db.models import User
from app.domain import timezones
from app.services import users

router = Router(name="onboarding")
router.message.filter(IsMember())
router.callback_query.filter(IsMember())


class TzForm(StatesGroup):
    text = State()


async def _save(message: Message, session: AsyncSession, user: User, tz: str) -> None:
    first_time = user.onboarded_at is None
    await users.set_tz(session, user, tz, datetime.now(UTC))
    await message.answer(t("tz.saved", tz=timezones.describe(tz)))
    if first_time:
        await message.answer(t("onboarding.done"))


@router.message(Command("tz"))
async def tz_command(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(t("tz.ask"), reply_markup=tz_keyboard())


@router.callback_query(Tz.filter())
async def tz_button(query: CallbackQuery, callback_data: Tz, session: AsyncSession, user: User, state: FSMContext):
    await query.answer()
    if callback_data.i == -1:
        await state.set_state(TzForm.text)
        await query.message.answer(t("tz.ask_text"))
        return
    if not 0 <= callback_data.i < len(timezones.POPULAR):
        return
    await query.message.edit_reply_markup(reply_markup=None)
    await _save(query.message, session, user, timezones.POPULAR[callback_data.i][1])


@router.message(StateFilter(TzForm.text), F.text)
async def tz_text(message: Message, session: AsyncSession, user: User, state: FSMContext) -> None:
    tz = timezones.parse_tz(message.text)
    if tz is None:
        await message.answer(t("tz.bad", text=html.escape(message.text[:40])))
        return
    await state.clear()
    await _save(message, session, user, tz)
