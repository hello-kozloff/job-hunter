"""Меню под полем ввода: «📋 Вакансии» (вкладки, листание, открыть карточку) и «📊 Статистика».

Список — одна панель, листание правит её на месте. Открытая из списка карточка приходит новым сообщением с кнопками
и становится «главной» (на неё отвечает письмо, её перерисовывают сводка и перепроверка).
"""

import html

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.callbacks import Menu
from app.bot.filters import IsMember
from app.bot.texts import t
from app.db.models import User, UserVacancy
from app.services import cards, menu

router = Router(name="menu")
router.message.filter(IsMember())
router.callback_query.filter(IsMember())

TABS = ("new", "apply", "maybe", "sent", "skip", "all")


async def list_view(session: AsyncSession, user: User, tab: str, page_no: int) -> tuple[str, InlineKeyboardMarkup]:
    tab = tab if tab in menu.TABS else "new"
    rows, total = await menu.page(session, user.id, tab, page_no)
    pages = max(1, (total + menu.PAGE - 1) // menu.PAGE)
    kb = InlineKeyboardBuilder()
    for name in TABS:
        mark = "• " if name == tab else ""
        kb.button(text=f"{mark}{t(f'tab.{name}')}", callback_data=Menu(action="list", tab=name))
    for uv, v in rows:
        label = f"{menu.STATUS_ICON.get(uv.status, '')} {v.title} — {v.company or ''}"
        kb.button(text=label[:64], callback_data=Menu(action="open", tab=tab, page=page_no, id=uv.id))
    nav = []
    if page_no > 0:
        kb.button(text="‹", callback_data=Menu(action="list", tab=tab, page=page_no - 1))
        nav.append(1)
    if page_no + 1 < pages:
        kb.button(text="›", callback_data=Menu(action="list", tab=tab, page=page_no + 1))
        nav.append(1)
    kb.adjust(len(TABS), *([1] * len(rows)), *([len(nav)] if nav else []))
    text = t("list.title", tab=t(f"tab.{tab}"), total=total)
    if total > menu.PAGE:
        text += " · " + t("list.page", page=page_no + 1, pages=pages)
    text += "\n\n" + (t("list.hint") if rows else t("list.empty"))
    return text, kb.as_markup()


async def stats_text(session: AsyncSession, user: User) -> str:
    c = await menu.counts(session, user.id)
    lines = [
        t("stats.title"),
        t("stats.cards", waiting=c["waiting"], approved=c["approved"], maybe=c["maybe"], skipped=c["skipped"],
          applied=c["applied"], expired=c["expired"], archived=c["archived"], quiet=c["quiet"]),
    ]
    for st in await menu.profile_stats(session, user.id):
        d = st.decisions
        block = t("stats.profile", label=html.escape(st.label), passed=st.passed, rejected=st.rejected,
                  apply=d["apply"], maybe=d["maybe"], skip=d["skip"], error=d["error"])
        if st.compared:
            block += "\n" + t("stats.shadow", agree=st.agree, compared=st.compared, pct=round(100 * st.agree / st.compared))
        if st.reasons:
            block += "\n" + t("stats.reasons", reasons=", ".join(f"{html.escape(r)} {n}" for r, n in st.reasons.most_common(4)))
        lines.append(block)
    return "\n\n".join(lines)[:4000]


@router.message(Command("vacancies"))
@router.message(F.text == t("menu.vacancies"))
async def vacancies(message: Message, session: AsyncSession, user: User, state: FSMContext) -> None:
    await state.clear()
    text, kb = await list_view(session, user, "new", 0)
    await message.answer(text, reply_markup=kb)


@router.message(Command("stats"))
@router.message(F.text == t("menu.stats"))
async def stats(message: Message, session: AsyncSession, user: User, state: FSMContext) -> None:
    await state.clear()
    await message.answer(await stats_text(session, user))


@router.callback_query(Menu.filter())
async def menu_button(query: CallbackQuery, callback_data: Menu, session: AsyncSession, user: User) -> None:
    if callback_data.action == "list":
        await query.answer()
        text, kb = await list_view(session, user, callback_data.tab, max(0, callback_data.page))
        try:
            await query.message.edit_text(text, reply_markup=kb)
        except TelegramBadRequest:
            pass
        return
    if callback_data.action == "open":
        uv = await session.scalar(
            select(UserVacancy).where(UserVacancy.id == callback_data.id, UserVacancy.user_id == user.id)
        )
        if uv is None:
            await query.answer(t("card.not_found"), show_alert=True)
            return
        await query.answer()
        await cards.resend(session, user, uv)
        return
    await query.answer()
