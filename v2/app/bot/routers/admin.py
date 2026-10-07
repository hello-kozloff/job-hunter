"""/admin: одна панель, правится на месте. Приглашения, заявки, пользователи, рассылка.

Весь роутер — только для администратора (фильтр IsAdmin на уровне роутера).
"""

import asyncio
import logging
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from aiogram import Bot, F, Router
from aiogram.exceptions import TelegramAPIError, TelegramRetryAfter
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.callbacks import Admin, Decide
from app.bot.filters import IsAdmin
from app.bot.texts import t
from app.bot.views import who
from app.db.models import User
from app.db.session import get_sessionmaker
from app.domain import timezones
from app.services import access, admin as admin_service, invites, users

log = logging.getLogger(__name__)
router = Router(name="admin")
router.message.filter(IsAdmin())
router.callback_query.filter(IsAdmin())

INVITE_USES = [1, 3, 5, 10]
INVITE_DAYS = [1, 7, 30, 0]  # 0 — бессрочно


class BroadcastForm(StatesGroup):
    message = State()


_bot_username: str | None = None
# Фоновые рассылки: держим ссылки, иначе задачу может собрать сборщик мусора
_tasks: set[asyncio.Task] = set()


async def bot_username(bot: Bot) -> str:
    global _bot_username
    if _bot_username is None:
        _bot_username = (await bot.get_me()).username
    return _bot_username


def _btn(kb: InlineKeyboardBuilder, text: str, action: str, arg: str | int = "") -> None:
    kb.button(text=text, callback_data=Admin(action=action, arg=str(arg)))


def _fmt_date(d: datetime | None, tz: str) -> str:
    return d.astimezone(ZoneInfo(tz)).strftime("%d.%m.%Y") if d else "—"


# ---------- Экраны ----------


async def home_view(session: AsyncSession) -> tuple[str, InlineKeyboardMarkup]:
    o = await admin_service.overview(session, datetime.now(UTC))
    kb = InlineKeyboardBuilder()
    _btn(kb, t("admin.btn_invites"), "inv")
    _btn(kb, t("admin.btn_requests", n=o.pending), "req")
    _btn(kb, t("admin.btn_users"), "users", 0)
    _btn(kb, t("admin.btn_broadcast"), "bc")
    _btn(kb, t("admin.btn_close"), "close")
    kb.adjust(2, 2, 1)
    text = t(
        "admin.home",
        users=o.users,
        blocked=o.blocked,
        pending=o.pending,
        invites=o.invites,
        fetches=o.fetches,
        alerts=o.alerts,
    )
    return text, kb.as_markup()


async def invites_view(session: AsyncSession, bot: Bot, tz: str) -> tuple[str, InlineKeyboardMarkup]:
    active = await invites.active(session, datetime.now(UTC))
    name = await bot_username(bot)
    lines = [
        t(
            "admin.invite_line",
            id=i.id,
            used=i.used,
            max=i.max_uses,
            expires=t("admin.invite_until", date=_fmt_date(i.expires_at, tz)) if i.expires_at else t("admin.invite_forever"),
            link=invites.link(name, i.code),
        )
        for i in active
    ]
    kb = InlineKeyboardBuilder()
    _btn(kb, t("admin.btn_new_invite"), "invn")
    for i in active:
        _btn(kb, t("admin.btn_revoke", id=i.id), "invr", i.id)
    _btn(kb, t("admin.btn_back"), "home")
    kb.adjust(1, *([3] * ((len(active) + 2) // 3)), 1)
    body = "\n\n".join(lines) if lines else t("admin.invites_empty")
    return t("admin.invites", list=body), kb.as_markup()


async def requests_view(session: AsyncSession) -> tuple[str, InlineKeyboardMarkup]:
    pending = await access.pending(session)
    kb = InlineKeyboardBuilder()
    lines = []
    for r in pending[:10]:
        lines.append(f"#{r.id} {who(r.tg_id, r.username, r.first_name)}")
        kb.button(text=f"✅ #{r.id}", callback_data=Decide(id=r.id, ok=True))
        kb.button(text=f"❌ #{r.id}", callback_data=Decide(id=r.id, ok=False))
    _btn(kb, t("admin.btn_back"), "home")
    kb.adjust(*([2] * len(pending[:10])), 1)
    body = "\n".join(lines) if lines else t("admin.requests_empty")
    return t("admin.requests", list=body), kb.as_markup()


async def users_view(session: AsyncSession, page_no: int) -> tuple[str, InlineKeyboardMarkup]:
    rows, total = await users.page(session, page_no)
    kb = InlineKeyboardBuilder()
    lines = []
    for u, n in rows:
        status = "⛔" if u.status == "blocked" else ("👑" if u.role == "admin" else "👤")
        lines.append(t("admin.user_line", status=status, who=who(u.tg_id, u.username, u.first_name), profiles=n))
        _btn(kb, f"{status} {u.first_name or u.tg_id}"[:30], "user", u.id)
    pages = (total + users.PAGE - 1) // users.PAGE
    nav = 0
    if page_no > 0:
        _btn(kb, "‹", "users", page_no - 1)
        nav += 1
    if page_no + 1 < pages:
        _btn(kb, "›", "users", page_no + 1)
        nav += 1
    _btn(kb, t("admin.btn_back"), "home")
    kb.adjust(*([2] * ((len(rows) + 1) // 2)), *([nav] if nav else []), 1)
    return t("admin.users", total=total, list="\n".join(lines)), kb.as_markup()


async def user_view(session: AsyncSession, user_id: int, tz: str) -> tuple[str, InlineKeyboardMarkup] | None:
    u = await users.get(session, user_id)
    if u is None:
        return None
    profiles = await users.profile_count(session, u.id)
    text = t(
        "admin.user",
        who=who(u.tg_id, u.username, u.first_name),
        tg_id=u.tg_id,
        role=u.role,
        status=u.status,
        tz=timezones.describe(u.tz),
        created=_fmt_date(u.created_at, tz),
        onboarded=t("yes") if u.onboarded_at else t("no"),
        profiles=profiles,
    )
    kb = InlineKeyboardBuilder()
    if u.role != "admin":
        if u.status == "blocked":
            _btn(kb, t("admin.btn_unblock"), "unblock", u.id)
        else:
            _btn(kb, t("admin.btn_block"), "block", u.id)
    _btn(kb, t("admin.btn_back"), "users", 0)
    kb.adjust(1)
    return text, kb.as_markup()


# ---------- Обработчики ----------


@router.message(Command("admin"))
async def admin_command(message: Message, session: AsyncSession, state: FSMContext) -> None:
    await state.clear()
    text, kb = await home_view(session)
    await message.answer(text, reply_markup=kb)


@router.callback_query(Admin.filter())
async def admin_button(
    query: CallbackQuery, callback_data: Admin, session: AsyncSession, user: User, bot: Bot, state: FSMContext
) -> None:
    action, arg = callback_data.action, callback_data.arg
    now = datetime.now(UTC)
    view: tuple[str, InlineKeyboardMarkup] | None = None

    if action == "home":
        view = await home_view(session)
    elif action == "close":
        await query.answer()
        await query.message.delete()
        return
    elif action == "inv":
        view = await invites_view(session, bot, user.tz)
    elif action == "invn":
        kb = InlineKeyboardBuilder()
        for n in INVITE_USES:
            _btn(kb, str(n), "invu", n)
        _btn(kb, t("admin.btn_back"), "inv")
        kb.adjust(len(INVITE_USES), 1)
        view = t("admin.invite_uses"), kb.as_markup()
    elif action == "invu":
        kb = InlineKeyboardBuilder()
        for d in INVITE_DAYS:
            _btn(kb, str(d) if d else t("admin.invite_forever_btn"), "invd", f"{arg}-{d}")
        _btn(kb, t("admin.btn_back"), "invn")
        kb.adjust(len(INVITE_DAYS), 1)
        view = t("admin.invite_days"), kb.as_markup()
    elif action == "invd":
        uses, days = (int(x) for x in arg.split("-"))
        if uses not in INVITE_USES or days not in INVITE_DAYS:
            await query.answer(t("stale"))
            return
        invite = await invites.create(session, user.id, uses, days or None, now)
        expires = t("admin.invite_until", date=_fmt_date(invite.expires_at, user.tz)) if days else t("admin.invite_forever")
        kb = InlineKeyboardBuilder()
        _btn(kb, t("admin.btn_back"), "inv")
        view = (
            t("admin.invite_created", id=invite.id, uses=uses, expires=expires, link=invites.link(await bot_username(bot), invite.code)),
            kb.as_markup(),
        )
    elif action == "invr":
        await invites.revoke(session, int(arg))
        await query.answer(t("admin.revoked"))
        text, kb = await invites_view(session, bot, user.tz)
        await query.message.edit_text(text, reply_markup=kb, disable_web_page_preview=True)
        return
    elif action == "req":
        view = await requests_view(session)
    elif action == "users":
        view = await users_view(session, max(0, int(arg or 0)))
    elif action == "user":
        view = await user_view(session, int(arg), user.tz)
    elif action in ("block", "unblock"):
        target = await users.set_status(session, int(arg), "blocked" if action == "block" else "active")
        if target is not None:
            try:
                await bot.send_message(target.tg_id, t("admin.blocked_note" if action == "block" else "admin.unblocked_note"))
            except TelegramAPIError as e:
                log.warning("user %s unreachable: %s", target.tg_id, e)
        view = await user_view(session, int(arg), user.tz)
    elif action == "bc":
        await state.set_state(BroadcastForm.message)
        await query.answer()
        await query.message.answer(t("admin.broadcast_ask"))
        return
    elif action == "bcs":
        await _broadcast_send(query, bot, state)
        return
    elif action == "bcx":
        await state.clear()
        await query.answer()
        await query.message.edit_text(t("admin.broadcast_cancelled"))
        return

    await query.answer()
    if view is None:
        await query.message.edit_text(t("stale"))
        return
    text, kb = view
    await query.message.edit_text(text, reply_markup=kb, disable_web_page_preview=True)


# ---------- Рассылка: сообщение админа копируется всем активным как есть ----------


@router.message(Command("cancel"), StateFilter(BroadcastForm.message))
async def broadcast_cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(t("admin.broadcast_cancelled"))


@router.message(StateFilter(BroadcastForm.message))
async def broadcast_preview(message: Message, session: AsyncSession, state: FSMContext) -> None:
    recipients = await users.active_tg_ids(session)
    await state.update_data(chat_id=message.chat.id, message_id=message.message_id)
    await message.copy_to(message.chat.id)
    kb = InlineKeyboardBuilder()
    _btn(kb, t("admin.btn_send"), "bcs")
    _btn(kb, t("admin.btn_cancel"), "bcx")
    await message.answer(t("admin.broadcast_preview", n=len(recipients)), reply_markup=kb.as_markup())


async def _broadcast_send(query: CallbackQuery, bot: Bot, state: FSMContext) -> None:
    data = await state.get_data()
    await state.clear()
    await query.answer()
    if "message_id" not in data:
        await query.message.edit_text(t("stale"))
        return
    await query.message.edit_text(t("admin.broadcast_started"))
    task = asyncio.create_task(_broadcast(bot, query.message.chat.id, data["chat_id"], data["message_id"]))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _broadcast(bot: Bot, report_chat: int, from_chat: int, message_id: int) -> None:
    """Фоном: по одному сообщению с паузой (лимит Telegram ~30/с), отчёт админу в конце."""
    async with get_sessionmaker()() as session:
        recipients = await users.active_tg_ids(session)
    ok = failed = 0
    for chat_id in recipients:
        try:
            await bot.copy_message(chat_id, from_chat, message_id)
            ok += 1
        except TelegramRetryAfter as e:
            await asyncio.sleep(e.retry_after)
            try:
                await bot.copy_message(chat_id, from_chat, message_id)
                ok += 1
            except TelegramAPIError:
                failed += 1
        except TelegramAPIError as e:
            log.info("broadcast to %s failed: %s", chat_id, e)
            failed += 1
        await asyncio.sleep(0.05)
    await bot.send_message(report_chat, t("admin.broadcast_done", ok=ok, failed=failed))
