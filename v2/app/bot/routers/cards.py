"""Кнопки карточки вакансии и ответ на «Почему?». Владелец проверяется в cards.press / set_reason."""

from aiogram import F, Router
from aiogram.dispatcher.event.bases import SkipHandler
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import StateFilter
from aiogram.types import CallbackQuery, ForceReply, Message
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.callbacks import Card, LetterBtn
from app.bot.filters import IsMember
from app.bot.profile_view import MENU
from app.bot.texts import t
from app.db.models import User
from app.services import cards, letters

router = Router(name="cards")
router.message.filter(IsMember())
router.callback_query.filter(IsMember())


@router.callback_query(Card.filter())
async def card_button(query: CallbackQuery, callback_data: Card, session: AsyncSession, user: User) -> None:
    out = await cards.press(session, user, callback_data.id, callback_data.action, callback_data.arg)
    if out is None:
        await query.answer(t("card.not_found"), show_alert=True)
        return
    await query.answer(out.toast or None)
    try:
        await query.message.edit_text(out.text, reply_markup=out.markup, disable_web_page_preview=True)
    except TelegramBadRequest:
        pass  # «message is not modified» — повторное нажатие той же кнопки
    if out.need_letter:
        letters.spawn(out.uv.id)
    if out.ask:
        # ForceReply прячет кнопки меню под полем ввода — после ответа они возвращаются (reason_reply)
        asked = await query.message.reply(out.ask, reply_markup=ForceReply(selective=True))
        await cards.set_ask(session, out.uv, asked.message_id)


@router.callback_query(LetterBtn.filter())
async def letter_button(query: CallbackQuery, callback_data: LetterBtn, session: AsyncSession, user: User) -> None:
    uv = await letters.owned(session, user, callback_data.id)
    if uv is None:
        await query.answer(t("card.not_found"), show_alert=True)
        return
    if callback_data.action == "redo":
        if uv.letter_lock:
            await query.answer(t("letter.busy"))
            return
        await query.answer(t("letter.writing"))
        letters.spawn(uv.id, "redo")
        return
    if callback_data.action in ("sent", "unsent"):
        text, kb = await letters.mark_sent(session, user, uv, callback_data.action == "sent")
        await query.answer()
        try:
            await query.message.edit_text(text, reply_markup=kb, disable_web_page_preview=True)
        except TelegramBadRequest:
            pass
        return
    await query.answer(t("stale"))


@router.message(StateFilter(None), F.reply_to_message, F.text, ~F.text.startswith("/"))
async def reason_reply(message: Message, session: AsyncSession, user: User) -> None:
    # Ответ на письмо — правка письма по пожеланию
    uv = await letters.by_letter_message(session, user, message.reply_to_message.message_id)
    if uv is not None:
        await message.answer(t("letter.revising"), reply_markup=MENU)
        letters.spawn(uv.id, "revise", message.text[:500])
        return
    uv = await cards.set_reason(session, user, message.reply_to_message.message_id, message.text)
    if uv is None:
        raise SkipHandler  # ответ не на карточку — пусть разбирают другие обработчики
    await message.answer(t("card.reason_saved"), reply_markup=MENU)
