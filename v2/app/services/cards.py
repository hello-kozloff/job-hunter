"""Карточки вакансий: одна на вакансию у пользователя (user_vacancies), оценки всех его резюме, кнопки.

Доставка (deliver) ждёт, пока вакансию оценят все резюме пользователя, через фильтр которых она прошла: тогда одна
карточка со строкой на каждое резюме. Без карточки (status quiet) — если все оценки skip, а теневой режим у этих
резюме выключен. Карточка уже отправлена, а оценка пришла позже (новое резюме) — карточка перерисовывается.

Нажатия (press) проверяют владельца: чужой id = «не найдено».
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.callbacks import Card
from app.bot.texts import t
from app.db.models import Blacklist, Match, Profile, User, UserVacancy, Vacancy
from app.domain import card
from app.domain.filter import builtin
from app.services import notify


# Как score.FRESH: старше — уже не оценится, карточку не держит
FRESH = timedelta(days=3)


async def _lines(
    session: AsyncSession, user_id: int, vacancy_id: int, now: datetime | None = None
) -> tuple[list[card.Line], bool, bool]:
    """(оценки резюме, ждём ли ещё оценок, нужна ли карточка)."""
    now = now or datetime.now(UTC)
    rows = (
        await session.execute(
            select(Match, Profile).join(Profile, Profile.id == Match.profile_id).where(
                Profile.user_id == user_id,
                Match.vacancy_id == vacancy_id,
                Match.filter_status.in_(("passed", "search_passed")),
            ).order_by(Profile.id)
        )
    ).all()
    # Ждём страницу вакансии или оценку работающего резюме; резюме на паузе карточку не держит
    pending = any(
        m.filter_status == "search_passed" or (m.decision is None and p.status == "active" and m.created_at > now - FRESH)
        for m, p in rows
    )
    lines = [card.Line(p.id, f"{p.emoji} {p.title}", m.decision, m.llm_reason) for m, p in rows if m.decision]
    visible = any(m.decision and (m.decision != "skip" or p.shadow) for m, p in rows)
    return lines, pending, visible


def keyboard(uv: UserVacancy, lines: list[card.Line], mode: str = "") -> InlineKeyboardMarkup:
    """mode: «» — по состоянию строки; choose — кнопки выбора («↩️ Изменить»); pick_apply / pick_ban — выбор резюме."""
    kb = InlineKeyboardBuilder()
    if mode in ("pick_apply", "pick_ban"):
        action = "apply" if mode == "pick_apply" else "ban"
        for x in lines:
            kb.button(text=x.label[:60], callback_data=Card(action=action, id=uv.id, arg=str(x.profile_id)))
        if action == "ban":
            kb.button(text=t("card.btn_ban_all"), callback_data=Card(action="ban", id=uv.id, arg="all"))
        kb.button(text=t("card.btn_back"), callback_data=Card(action="edit", id=uv.id))
        kb.adjust(1)
        return kb.as_markup()
    if mode != "choose" and (uv.my_decision or uv.status in card.FINAL):
        kb.button(text=t("card.btn_edit"), callback_data=Card(action="edit", id=uv.id))
        return kb.as_markup()
    for choice in ("apply", "maybe", "skip", "earlier"):
        kb.button(text=card.CHOICE[choice], callback_data=Card(action=choice, id=uv.id))
    kb.button(text=t("card.btn_ban"), callback_data=Card(action="ban", id=uv.id))
    kb.adjust(3, 2)
    return kb.as_markup()


def render(uv: UserVacancy, v: Vacancy, lines: list[card.Line], tz: str) -> str:
    chosen = next((x.label for x in lines if x.profile_id == uv.chosen_profile_id), None) if len(lines) > 1 else None
    return card.text(v, lines, tz, uv.status, uv.my_decision, uv.my_reason, chosen, uv.applied_at)


async def deliver(session: AsyncSession, user_id: int, vacancy_id: int, now: datetime) -> UserVacancy | None:
    lines, pending, visible = await _lines(session, user_id, vacancy_id, now)
    if pending or not lines:
        return None
    await session.execute(
        insert(UserVacancy).values(user_id=user_id, vacancy_id=vacancy_id, status="quiet").on_conflict_do_nothing()
    )
    uv = await session.scalar(
        select(UserVacancy).where(UserVacancy.user_id == user_id, UserVacancy.vacancy_id == vacancy_id)
    )
    user = await session.get(User, user_id)
    v = await session.get(Vacancy, vacancy_id)
    if uv.tg_card_id:
        await notify.edit(user.tg_id, uv.tg_card_id, render(uv, v, lines, user.tz), reply_markup=keyboard(uv, lines))
    elif visible:
        if uv.status == "quiet":
            uv.status = "waiting"
        mid = await notify.send(
            user.tg_id,
            render(uv, v, lines, user.tz),
            reply_markup=keyboard(uv, lines),
            disable_notification=card.is_quiet_hour(user.tz, now),
        )
        if mid:
            uv.tg_card_id, uv.card_at = mid, now
        else:
            uv.status = "quiet"  # бот заблокирован пользователем и т. п. — карточки нет
    await session.commit()
    return uv


@dataclass
class Pressed:
    uv: UserVacancy
    text: str
    markup: InlineKeyboardMarkup
    toast: str = ""
    ask: str = ""


async def _ban(session: AsyncSession, v: Vacancy, profile_ids: list[int]) -> None:
    for pid in profile_ids:
        conds = [Blacklist.company == v.company] if v.company else []
        if v.company_id:
            conds.append(Blacklist.company_id == v.company_id)
        exists = await session.scalar(select(Blacklist.id).where(Blacklist.profile_id == pid, or_(*conds)).limit(1))
        if not exists:
            session.add(Blacklist(profile_id=pid, company=v.company, company_id=v.company_id, comment=f"кнопка на карточке: {v.title}"[:500]))


async def press(session: AsyncSession, user: User, uv_id: int, action: str, arg: str = "") -> Pressed | None:
    uv = await session.scalar(select(UserVacancy).where(UserVacancy.id == uv_id, UserVacancy.user_id == user.id))
    if uv is None:
        return None
    v = await session.get(Vacancy, uv.vacancy_id)
    lines, _, _ = await _lines(session, user.id, uv.vacancy_id)
    ids = {x.profile_id for x in lines}
    out = Pressed(uv, "", None)  # type: ignore[arg-type]

    if action in ("apply", "ban") and not arg and len(lines) > 1:
        out.markup = keyboard(uv, lines, f"pick_{action}")
        out.toast = t(f"card.pick_{action}")
        out.text = render(uv, v, lines, user.tz)
        return out
    pid = int(arg) if arg.isdigit() else (lines[0].profile_id if lines else None)
    if arg.isdigit() and pid not in ids:
        return None  # чужое или не оценивавшее вакансию резюме

    if action == "ban":
        if not builtin.norm_company(v.company or "") and not v.company_id:
            out.toast = t("card.not_found")
        else:
            await _ban(session, v, sorted(ids) if arg == "all" else [pid] if pid else [])
            uv.my_decision, uv.my_reason, uv.status = "skip", card.BAN_REASON, card.STATUS_BY_CHOICE["skip"]
            out.toast = t("card.banned", company=v.company or "Компания")
    elif action in card.CHOICE:
        if uv.my_reason == card.BAN_REASON:
            uv.my_reason = None
        uv.my_decision, uv.status = action, card.STATUS_BY_CHOICE[action]
        if action == "apply":
            uv.chosen_profile_id = pid
        out.toast = t("card.saved", choice=card.CHOICE[action])
        # Расхождение с нейросетью → «Почему?» (для ✅ — с оценкой выбранного резюме, иначе — с лучшей из оценок)
        ref = next((x.decision for x in lines if x.profile_id == pid), None) if action == "apply" else card.best(lines)
        if action != "earlier" and ref in card.RANK and ref != action and not uv.my_reason:
            out.ask = t("card.ask", verdict=card.VERDICT[ref], choice=card.CHOICE[action])
    elif action == "edit":
        # Вернуть кнопки выбора; решение не меняется, пока не нажата другая кнопка
        out.markup = keyboard(uv, lines, "choose")
        out.text = render(uv, v, lines, user.tz)
        return out
    else:
        return None
    await session.commit()
    out.text = render(uv, v, lines, user.tz)
    out.markup = keyboard(uv, lines)
    return out


async def set_ask(session: AsyncSession, uv: UserVacancy, message_id: int) -> None:
    uv.tg_ask_id = message_id
    await session.commit()


async def set_reason(session: AsyncSession, user: User, reply_to: int, text: str) -> UserVacancy | None:
    """Ответ на «Почему?» (или на саму карточку) → my_reason."""
    uv = await session.scalar(
        select(UserVacancy).where(
            UserVacancy.user_id == user.id, or_(UserVacancy.tg_ask_id == reply_to, UserVacancy.tg_card_id == reply_to)
        )
    )
    if uv is None:
        return None
    uv.my_reason = text[:500]
    await session.commit()
    return uv
