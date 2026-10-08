"""Меню пользователя: список вакансий по вкладкам и статистика (порт W7 v1, docs/bot-menu.md).

Всё ограничено user_id владельца.
"""

from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Match, Profile, UserVacancy, Vacancy

PAGE = 8
# Вкладка → статусы карточек
TABS: dict[str, tuple[str, ...]] = {
    "new": ("waiting",),
    "apply": ("approved",),
    "maybe": ("maybe",),
    "sent": ("applied",),
    "skip": ("skipped",),
    "all": ("waiting", "approved", "maybe", "applied", "skipped", "expired", "archived"),
}
STATUS_ICON = {
    "waiting": "🆕", "approved": "✅", "maybe": "🤔", "applied": "📨", "skipped": "❌", "expired": "⌛", "archived": "🔒",
}


async def page(session: AsyncSession, user_id: int, tab: str, page_no: int) -> tuple[list[tuple[UserVacancy, Vacancy]], int]:
    statuses = TABS.get(tab, TABS["new"])
    where = (UserVacancy.user_id == user_id, UserVacancy.status.in_(statuses))
    total = await session.scalar(select(func.count()).select_from(UserVacancy).where(*where)) or 0
    rows = (
        await session.execute(
            select(UserVacancy, Vacancy)
            .join(Vacancy, Vacancy.id == UserVacancy.vacancy_id)
            .where(*where)
            .order_by(UserVacancy.card_at.desc().nulls_last(), UserVacancy.id.desc())
            .offset(page_no * PAGE)
            .limit(PAGE)
        )
    ).all()
    return [(uv, v) for uv, v in rows], total


async def counts(session: AsyncSession, user_id: int) -> Counter:
    rows = await session.execute(
        select(UserVacancy.status, func.count()).where(UserVacancy.user_id == user_id).group_by(UserVacancy.status)
    )
    return Counter({s: n for s, n in rows.all()})


@dataclass
class ProfileStats:
    label: str
    passed: int = 0
    rejected: int = 0
    decisions: Counter = field(default_factory=Counter)
    # Теневой режим: решение пользователя совпало с оценкой этого резюме
    agree: int = 0
    compared: int = 0
    reasons: Counter = field(default_factory=Counter)


async def profile_stats(session: AsyncSession, user_id: int, since=None) -> list[ProfileStats]:
    """По резюме: фильтр, оценки нейросети, совпадение с решениями пользователя. since — только совпадения новее."""
    out = []
    for p in await session.scalars(select(Profile).where(Profile.user_id == user_id).order_by(Profile.id)):
        st = ProfileStats(f"{p.emoji} {p.title}")
        stmt = select(Match.filter_status, Match.decision, Match.reasons, UserVacancy.my_decision).outerjoin(
            UserVacancy, (UserVacancy.vacancy_id == Match.vacancy_id) & (UserVacancy.user_id == user_id)
        ).where(Match.profile_id == p.id)
        if since is not None:
            stmt = stmt.where(Match.created_at > since)
        for status, decision, reasons, mine in (await session.execute(stmt)).all():
            if status == "rejected":
                st.rejected += 1
                st.reasons.update(r.split(":")[0] for r in reasons or [])
                continue
            st.passed += 1
            if decision:
                st.decisions[decision] += 1
            if decision in ("apply", "maybe", "skip") and mine in ("apply", "maybe", "skip"):
                st.compared += 1
                st.agree += decision == mine
        out.append(st)
    return out
