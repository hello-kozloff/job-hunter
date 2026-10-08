"""Сопроводительные письма (порт W5 v1): по ✅ на карточке, «🔄 Переписать», правка ответом на письмо.

Письмо пишется от резюме, выбранного при ✅ (user_vacancies.chosen_profile_id), и приходит ответом на карточку:
[📝 Отклик на hh] [🔗 Вакансия] / [🔄 Переписать] [📨 Отправил]; прежнее сообщение с письмом удаляется.
Защита от двойного нажатия — letter_lock (UPDATE «где пусто или старше 3 мин», как в v1).
"""

import asyncio
import html
import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from aiogram.types import InlineKeyboardMarkup, ReplyParameters
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.callbacks import LetterBtn
from app.bot.texts import t
from app.db.models import Profile, ProfileConfig as ConfigRow, Resume, User, UserVacancy, Vacancy
from app.db.session import get_sessionmaker
from app.domain import resume_text
from app.domain.llm import letter as prompts
from app.domain.profile_config import ProfileConfig
from app.services import cards, llm, notify

log = logging.getLogger(__name__)

LOCK_TTL = timedelta(minutes=3)
HEAD = {"new": "letter.head_new", "redo": "letter.head_redo", "revise": "letter.head_revise"}
_tasks: set[asyncio.Task] = set()


def keyboard(uv: UserVacancy, v: Vacancy) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    if uv.status == "applied":
        kb.button(text=t("letter.btn_unsent"), callback_data=LetterBtn(action="unsent", id=uv.id))
        return kb.as_markup()
    kb.button(text=t("letter.btn_apply"), url=v.apply_url or v.url)
    kb.button(text=t("letter.btn_open"), url=v.url)
    kb.button(text=t("letter.btn_redo"), callback_data=LetterBtn(action="redo", id=uv.id))
    kb.button(text=t("letter.btn_sent"), callback_data=LetterBtn(action="sent", id=uv.id))
    kb.adjust(2, 2)
    return kb.as_markup()


def render(uv: UserVacancy, v: Vacancy, mode: str, tz: str, problem: str | None = None, instruction: str | None = None) -> str:
    head = t(HEAD.get(mode, HEAD["new"]), url=html.escape(v.url), title=html.escape(v.title), company=html.escape(v.company or ""))
    if problem:
        return f"{head}\n{t('letter.failed', problem=html.escape(problem))}"
    parts = [head]
    if mode == "revise" and instruction:
        parts.append(t("letter.wish", text=html.escape(instruction)))
    parts.append(f"<pre>{html.escape(uv.letter or '')}</pre>")
    if uv.status == "applied":
        when = f" {uv.applied_at.astimezone(ZoneInfo(tz)):%d.%m}" if uv.applied_at else ""
        parts.append(t("letter.sent", when=when))
    else:
        if v.has_test:
            parts.append(t("letter.has_test"))
        parts.append(t("letter.hint"))
    return "\n".join(parts)[:4000]


async def _lock(session: AsyncSession, uv_id: int, now: datetime) -> bool:
    got = await session.scalar(
        update(UserVacancy)
        .where(UserVacancy.id == uv_id, or_(UserVacancy.letter_lock.is_(None), UserVacancy.letter_lock < now - LOCK_TTL))
        .values(letter_lock=now)
        .returning(UserVacancy.id)
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    return got is not None


async def generate(session: AsyncSession, uv_id: int, mode: str = "new", instruction: str | None = None) -> bool:
    """Написать письмо и прислать его ответом на карточку. False — уже пишется (блокировка) или не к чему."""
    now = datetime.now(UTC)
    if not await _lock(session, uv_id, now):
        return False
    uv = await session.get(UserVacancy, uv_id, populate_existing=True)
    try:
        user = await session.get(User, uv.user_id)
        v = await session.get(Vacancy, uv.vacancy_id)
        profile = await session.get(Profile, uv.chosen_profile_id) if uv.chosen_profile_id else None
        if profile is None or profile.user_id != user.id or profile.active_config_id is None:
            return False
        config = ProfileConfig.model_validate((await session.get(ConfigRow, profile.active_config_id)).config)
        resume = await session.scalar(select(Resume).where(Resume.profile_id == profile.id).order_by(Resume.id.desc()).limit(1))
        structured = resume.structured if resume else {}
        text = resume_text.strip_contacts(resume.raw_text) if resume else ""
        problem = None
        try:
            answer = await llm.ask(
                session,
                kind="letter",
                system=prompts.system_prompt(config.letter, structured, text),
                prompt=prompts.task(v, structured, text, mode, uv.letter, instruction),
                schema=prompts.Letter,
                provider=config.llm.provider,
                user_id=user.id,
                profile_id=profile.id,
                temperature=prompts.TEMPERATURE.get(mode, 0.4),
            )
            if not answer.letter.strip():
                raise llm.LlmError("пустое письмо")
            uv.letter = prompts.finish(answer.letter, config.letter)
            if mode == "revise" and instruction:
                uv.letter_notes = [*(uv.letter_notes or []), instruction[:300]]
        except llm.LlmError as e:
            problem = str(e)
        old = uv.tg_letter_id
        msg = await notify.send(
            user.tg_id,
            render(uv, v, mode, user.tz, problem, instruction),
            reply_markup=keyboard(uv, v) if not problem else _retry(uv),
            reply_parameters=ReplyParameters(message_id=uv.tg_card_id, allow_sending_without_reply=True) if uv.tg_card_id else None,
        )
        if msg:
            uv.tg_letter_id = msg
            if old:
                await notify.delete(user.tg_id, old)
        return problem is None
    finally:
        uv.letter_lock = None
        await session.commit()


def _retry(uv: UserVacancy) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text=t("letter.btn_redo"), callback_data=LetterBtn(action="redo", id=uv.id))
    return kb.as_markup()


def spawn(uv_id: int, mode: str = "new", instruction: str | None = None) -> None:
    """Письмо в фоне (нейросеть думает до 10 с — кнопка не должна висеть)."""

    async def job() -> None:
        try:
            async with get_sessionmaker()() as session:
                await generate(session, uv_id, mode, instruction)
        except Exception:
            log.exception("letter for %s failed", uv_id)

    task = asyncio.create_task(job())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def owned(session: AsyncSession, user: User, uv_id: int) -> UserVacancy | None:
    return await session.scalar(select(UserVacancy).where(UserVacancy.id == uv_id, UserVacancy.user_id == user.id))


async def mark_sent(session: AsyncSession, user: User, uv: UserVacancy, sent: bool) -> tuple[str, InlineKeyboardMarkup]:
    """«📨 Отправил» / «↩️ Отменить»: статус, письмо и карточка перерисовываются."""
    if sent:
        uv.status, uv.applied_at = "applied", datetime.now(UTC)
    else:
        uv.status, uv.applied_at = "approved", None
    await session.commit()
    v = await session.get(Vacancy, uv.vacancy_id)
    await cards.refresh(session, user, uv)
    return render(uv, v, "new", user.tz), keyboard(uv, v)


async def by_letter_message(session: AsyncSession, user: User, message_id: int) -> UserVacancy | None:
    return await session.scalar(
        select(UserVacancy).where(UserVacancy.user_id == user.id, UserVacancy.tg_letter_id == message_id)
    )
