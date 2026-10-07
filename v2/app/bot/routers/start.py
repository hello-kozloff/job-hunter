"""Вход в бота: /start с инвайтом или без, заявка на доступ, решение админа по заявке."""

import logging
from datetime import UTC, datetime

from aiogram import Bot, F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.callbacks import Decide, RequestAccess
from app.bot.commands import set_admin_commands
from app.bot.filters import IsAdmin
from app.bot.profile_view import MENU
from app.bot.routers.profiles import ask_resume
from app.bot.texts import t
from app.bot.views import tz_keyboard, who
from app.db.models import User
from app.services import access, invites, profiles, users

log = logging.getLogger(__name__)
router = Router(name="start")


def _request_keyboard():
    kb = InlineKeyboardBuilder()
    kb.button(text=t("btn.request"), callback_data=RequestAccess())
    return kb.as_markup()


async def notify_admins(bot: Bot, session: AsyncSession, text: str, reply_markup=None) -> None:
    for admin in await users.admins(session):
        try:
            await bot.send_message(admin.tg_id, text, reply_markup=reply_markup)
        except TelegramAPIError as e:
            log.warning("admin %s unreachable: %s", admin.tg_id, e)


async def begin_onboarding(bot: Bot, chat_id: int) -> None:
    await bot.send_message(chat_id, t("start.welcome"))
    await bot.send_message(chat_id, t("tz.ask"), reply_markup=tz_keyboard())


@router.message(CommandStart())
async def start(
    message: Message, command: CommandObject, session: AsyncSession, user: User | None, bot: Bot, state: FSMContext
) -> None:
    sender = message.from_user
    if sender is None:
        return
    if user is not None:
        if user.role == "admin":
            # Меню с /admin: при старте бота не ставится, пока администратор не написал ему
            await set_admin_commands(bot, message.chat.id)
        if user.status == "blocked":
            await message.answer(t("start.blocked"))
        elif user.onboarded_at is None:
            await begin_onboarding(bot, message.chat.id)
        else:
            await message.answer(t("start.welcome_back"), reply_markup=MENU)
            if user.role == "admin":
                await message.answer(t("start.admin"))
            if not await profiles.list_for_user(session, user.id):
                await ask_resume(message, state)
        return

    code = invites.code_from_payload(command.args)
    if code is None:
        await message.answer(t("start.closed"), reply_markup=_request_keyboard())
        return
    redeemed = await invites.redeem(session, code, sender.id, sender.username, sender.first_name, datetime.now(UTC))
    if redeemed is None:
        await message.answer(t("start.bad_invite"), reply_markup=_request_keyboard())
        return
    await notify_admins(
        bot, session, t("admin.joined", invite=redeemed.invite.id, who=who(sender.id, sender.username, sender.first_name))
    )
    await begin_onboarding(bot, message.chat.id)


@router.callback_query(RequestAccess.filter())
async def request_access(query: CallbackQuery, session: AsyncSession, user: User | None, bot: Bot) -> None:
    sender = query.from_user
    if user is not None:
        await query.answer(t("request.member"), show_alert=True)
        return
    req, is_new = await access.request(session, sender.id, sender.username, sender.first_name)
    await query.answer()
    if not is_new:
        await query.message.answer(t("request.already"))
        return
    await query.message.answer(t("request.sent"))
    kb = InlineKeyboardBuilder()
    kb.button(text=t("admin.approve"), callback_data=Decide(id=req.id, ok=True))
    kb.button(text=t("admin.reject"), callback_data=Decide(id=req.id, ok=False))
    await notify_admins(
        bot,
        session,
        t("admin.new_request", who=who(sender.id, sender.username, sender.first_name)),
        reply_markup=kb.as_markup(),
    )


@router.callback_query(Decide.filter(), IsAdmin())
async def decide(query: CallbackQuery, callback_data: Decide, session: AsyncSession, user: User, bot: Bot) -> None:
    result = await access.decide(session, callback_data.id, callback_data.ok, user, datetime.now(UTC))
    if result is None:
        await query.answer(t("admin.request_taken"), show_alert=True)
        await query.message.edit_reply_markup(reply_markup=None)
        return
    req, _ = result
    await query.answer()
    status = t("admin.approve") if callback_data.ok else t("admin.reject")
    await query.message.edit_text(
        t(
            "admin.request_done",
            status=status,
            who=who(req.tg_id, req.username, req.first_name),
            admin=who(user.tg_id, user.username, user.first_name),
        )
    )
    try:
        if callback_data.ok:
            await bot.send_message(req.tg_id, t("request.approved"))
            await begin_onboarding(bot, req.tg_id)
        else:
            await bot.send_message(req.tg_id, t("request.rejected"))
    except TelegramAPIError as e:
        log.warning("requester %s unreachable: %s", req.tg_id, e)


@router.callback_query(Decide.filter())
async def decide_not_admin(query: CallbackQuery) -> None:
    await query.answer(t("admin.only"), show_alert=True)
