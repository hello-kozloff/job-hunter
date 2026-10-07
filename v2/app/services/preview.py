"""Предпросмотр правки фильтра: что изменится на последних вакансиях резюме (из общего пула)."""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Match, Vacancy
from app.domain.filter import builtin, engine
from app.domain.profile_config import FilterConfig

LAST = 50


def reasons(f: FilterConfig, v: Vacancy) -> list[str]:
    view = {"title": v.title, "skills": v.key_skills, "snippet": v.snippet or "", "experience": v.experience or "",
            "company": v.company or "", "description": v.description or ""}
    out = engine.reasons(f.rules, view, "search")
    if f.max_responses and (v.responses or 0) > f.max_responses:
        out.append(f"> {f.max_responses} откликов")
    if v.page_status == "ok":
        if f.only_rf and builtin.only_rf(v.description or ""):
            out.append("только из РФ")
        out += engine.reasons(f.rules, view, "page")
    return out


@dataclass
class Diff:
    total: int = 0
    now_rejected: list[tuple[str, list[str]]] = field(default_factory=list)
    now_passed: list[str] = field(default_factory=list)


async def diff(session: AsyncSession, profile_id: int, old: FilterConfig, new: FilterConfig) -> Diff:
    rows = await session.scalars(
        select(Vacancy).join(Match, Match.vacancy_id == Vacancy.id).where(Match.profile_id == profile_id)
        .order_by(Match.id.desc()).limit(LAST)
    )
    d = Diff()
    for v in rows:
        d.total += 1
        before, after = reasons(old, v), reasons(new, v)
        if after and not before:
            d.now_rejected.append((v.title, after))
        elif before and not after:
            d.now_passed.append(v.title)
    return d
