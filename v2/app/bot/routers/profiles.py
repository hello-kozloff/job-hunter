"""Резюме: приём (файл, ссылка hh, текст), список, карточка с настройками, правила, правка текстом.

Каждое нажатие по профилю проверяет владельца (profiles.load / get_owned) — чужой id = «не найдено».
"""

import html
import io

from aiogram import Bot, F, Router
from aiogram.enums import ChatAction
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import profile_view as view
from app.bot.callbacks import Prof
from app.bot.filters import IsMember
from app.bot.texts import t
from app.db.models import User
from app.domain import resume_text
from app.domain.llm.draft import ConfigEdit
from app.domain.resume_text import ResumeTextError
from app.services import collect, hh_resume, profiles
from app.services.llm import LlmError

router = Router(name="profiles")
router.message.filter(IsMember())
router.callback_query.filter(IsMember())

MAX_FILE = 5 * 1024 * 1024


class ResumeForm(StatesGroup):
    waiting = State()


class EditForm(StatesGroup):
    text = State()
    confirm = State()


async def ask_resume(message: Message, state: FSMContext) -> None:
    await state.set_state(ResumeForm.waiting)
    await message.answer(t("resume.ask"), reply_markup=view.MENU)


async def _show_card(message: Message, loaded: profiles.Loaded, edit: bool = False) -> None:
    text, kb = view.card_text(loaded), view.card_keyboard(loaded.profile)
    if edit:
        await message.edit_text(text, reply_markup=kb)
    else:
        await message.answer(text, reply_markup=kb)


async def _create(message: Message, session: AsyncSession, user: User, state: FSMContext, source: str, ref, text: str):
    limit = (user.limits or {}).get("profiles")
    if limit and len(await profiles.list_for_user(session, user.id)) >= limit:
        await message.answer(t("resume.limit", n=limit))
        return
    progress = await message.answer(t("resume.reading"))
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)
    try:
        profile = await profiles.create_from_text(session, user, source, ref, text)
    except (ResumeTextError, LlmError) as e:
        await progress.edit_text(t("resume.error", error=html.escape(str(e))))
        return
    await state.clear()
    await progress.edit_text(t("resume.created"))
    loaded = await profiles.load(session, user.id, profile.id)
    await _show_card(message, loaded)


# ---------- Приём резюме ----------


@router.message(F.document)
async def resume_file(message: Message, session: AsyncSession, user: User, state: FSMContext, bot: Bot) -> None:
    """Файл принимаем и вне шага «пришли резюме» — так проще всего добавить ещё одно."""
    doc = message.document
    if doc.file_size and doc.file_size > MAX_FILE:
        await message.answer(t("resume.too_big"))
        return
    buf = io.BytesIO()
    await bot.download(doc, destination=buf)
    try:
        text = resume_text.from_file(doc.file_name or "", buf.getvalue())
    except ResumeTextError as e:
        await message.answer(t("resume.error", error=html.escape(str(e))))
        return
    await _create(message, session, user, state, "file", doc.file_name, text)


# Команды и кнопка меню на шаге «пришли резюме» — не резюме
@router.message(StateFilter(ResumeForm.waiting), F.text, ~F.text.startswith("/"), F.text != t("menu.resumes"))
async def resume_text_or_link(message: Message, session: AsyncSession, user: User, state: FSMContext) -> None:
    url = hh_resume.find_url(message.text)
    if url:
        try:
            text = await hh_resume.fetch_text(session, url)
        except ResumeTextError as e:
            await message.answer(t("resume.error", error=html.escape(str(e))))
            return
        await _create(message, session, user, state, "hh", url, text)
        return
    if len(message.text) < resume_text.MIN_CHARS:
        await message.answer(t("resume.short_text"))
        return
    await _create(message, session, user, state, "text", None, resume_text.normalize(message.text))


@router.message(F.text.startswith("https://") & F.text.contains("/resume/"))
async def resume_link_any_time(message: Message, session: AsyncSession, user: User, state: FSMContext) -> None:
    await resume_text_or_link(message, session, user, state)


# ---------- Список и карточка ----------


@router.message(Command("resumes"))
@router.message(F.text == t("menu.resumes"))
async def list_command(message: Message, session: AsyncSession, user: User, state: FSMContext) -> None:
    await state.clear()
    text, kb = view.list_view(await profiles.list_for_user(session, user.id))
    await message.answer(text, reply_markup=kb)


@router.callback_query(Prof.filter())
async def profile_button(
    query: CallbackQuery, callback_data: Prof, session: AsyncSession, user: User, state: FSMContext
) -> None:
    action, pid = callback_data.action, callback_data.pid
    if action == "list":
        await query.answer()
        text, kb = view.list_view(await profiles.list_for_user(session, user.id))
        await query.message.edit_text(text, reply_markup=kb)
        return
    if action == "add":
        await query.answer()
        await ask_resume(query.message, state)
        return

    loaded = await profiles.load(session, user.id, pid)
    if loaded is None:
        await query.answer(t("profile.not_found"), show_alert=True)
        return
    p = loaded.profile

    if action == "open":
        await query.answer()
        await _show_card(query.message, loaded, edit=True)
    elif action == "rules":
        await query.answer()
        await query.message.edit_text(t("profile.rules"), reply_markup=view.rules_keyboard(loaded))
    elif action == "rule":
        await profiles.toggle_rule(session, loaded, callback_data.arg)
        await query.answer()
        loaded = await profiles.load(session, user.id, pid)
        await query.message.edit_reply_markup(reply_markup=view.rules_keyboard(loaded))
    elif action in ("start", "pause"):
        await profiles.set_status(session, p, "active" if action == "start" else "paused")
        await query.answer(t("profile.started") if action == "start" else None, show_alert=action == "start")
        await _show_card(query.message, loaded, edit=True)
    elif action == "shadow":
        await profiles.set_shadow(session, p, not p.shadow)
        await query.answer()
        await _show_card(query.message, loaded, edit=True)
    elif action == "collect":
        ok = await collect.trigger(p.id, query.message.chat.id, "bot" if p.status == "active" else "trial")
        await query.answer(t("collect.started") if ok else t("collect.failed"), show_alert=True)
    elif action == "del":
        await query.answer()
        kb = InlineKeyboardBuilder()
        kb.button(text=t("profile.btn_delete_yes"), callback_data=Prof(action="delok", pid=p.id))
        kb.button(text=t("profile.btn_back"), callback_data=Prof(action="open", pid=p.id))
        kb.adjust(1)
        await query.message.edit_text(t("profile.delete_confirm", title=html.escape(p.title)), reply_markup=kb.as_markup())
    elif action == "delok":
        await profiles.delete(session, p)
        await query.answer(t("profile.deleted"))
        text, kb = view.list_view(await profiles.list_for_user(session, user.id))
        await query.message.edit_text(text, reply_markup=kb)
    elif action == "edit":
        await query.answer()
        await state.set_state(EditForm.text)
        await state.update_data(pid=p.id)
        await query.message.answer(t("edit.ask"))
    elif action == "apply":
        data = await state.get_data()
        await state.clear()
        if data.get("pid") != p.id or "edit" not in data:
            await query.answer(t("stale"), show_alert=True)
            return
        version = await profiles.apply_edit(session, loaded, ConfigEdit.model_validate(data["edit"]), data.get("request", ""))
        await query.answer(t("edit.applied", version=version))
        await query.message.edit_text(t("edit.applied", version=version))
        await _show_card(query.message, await profiles.load(session, user.id, pid))
    elif action == "cancel":
        await state.clear()
        await query.answer()
        await query.message.edit_text(t("edit.cancelled"))
    else:
        await query.answer(t("stale"))


# ---------- Правка текстом ----------


@router.message(Command("cancel"), StateFilter(EditForm.text, EditForm.confirm, ResumeForm.waiting))
async def cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(t("edit.cancelled"), reply_markup=view.MENU)


@router.message(StateFilter(EditForm.text), F.text)
async def edit_text(message: Message, session: AsyncSession, user: User, state: FSMContext) -> None:
    data = await state.get_data()
    loaded = await profiles.load(session, user.id, data.get("pid", 0))
    if loaded is None:
        await state.clear()
        await message.answer(t("profile.not_found"))
        return
    progress = await message.answer(t("edit.thinking"))
    try:
        edit = await profiles.propose_edit(session, user, loaded, message.text)
    except LlmError as e:
        await progress.edit_text(t("resume.error", error=html.escape(str(e))))
        return
    if edit.question:
        await progress.edit_text(t("edit.question", question=html.escape(edit.question)))
        return
    if not edit.changes:
        await progress.edit_text(t("edit.nothing"))
        return
    await state.set_state(EditForm.confirm)
    await state.update_data(edit=edit.model_dump(mode="json"), request=message.text)
    kb = InlineKeyboardBuilder()
    kb.button(text=t("edit.btn_apply"), callback_data=Prof(action="apply", pid=loaded.profile.id))
    kb.button(text=t("edit.btn_cancel"), callback_data=Prof(action="cancel", pid=loaded.profile.id))
    changes = "\n".join(f"• {html.escape(c)}" for c in edit.changes)
    await progress.edit_text(t("edit.preview", changes=changes), reply_markup=kb.as_markup())
