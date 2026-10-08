"""Ежедневное (порт W6 v1): утренняя сводка по поясу пользователя, «⌛ устарела», «🔒 закрыта на hh», чистка.

n8n v2 «V2 Daily» раз в час зовёт /internal/daily (сводки, устаревшие, чистка + план перепроверки) и грузит
страницы вакансий из плана → /internal/recheck/vacancy. Сводка уходит один раз в день, в первый вызов после 09:00
по поясу пользователя (Mac спал — придёт позже, но придёт).
"""

import html
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.texts import t
from app.db.models import FetchLog, Profile, Run, SystemState, User, UserVacancy, Vacancy
from app.domain.hh import parse
from app.services import alerts, cards, collect, menu, notify

SUMMARY_HOUR = 9
EXPIRE_AFTER = timedelta(days=3)
OPEN = ("waiting", "approved", "maybe")
RECHECK_EVERY = timedelta(days=1)
RECHECK_PER_CALL = 20


# ---------- Устаревшие ----------


async def expire(session: AsyncSession, now: datetime) -> int:
    """Карточка без решения 3 дня → «⌛ устарела» (кнопки остаются: решить можно и позже)."""
    rows = list(
        await session.scalars(
            select(UserVacancy).where(UserVacancy.status == "waiting", UserVacancy.card_at < now - EXPIRE_AFTER)
        )
    )
    for uv in rows:
        uv.status = "expired"
    await session.commit()
    for uv in rows:
        await cards.refresh(session, await session.get(User, uv.user_id), uv)
    return len(rows)


# ---------- Закрытые на hh ----------


async def recheck_plan(session: AsyncSession, now: datetime) -> list[dict]:
    """Вакансии с открытыми карточками, которые давно не проверяли: закрыта ли на hh."""
    if await collect._stopped_until(session, now):
        return []
    rows = await session.execute(
        select(Vacancy.id, Vacancy.url)
        .where(
            Vacancy.archived_at.is_(None),
            func.coalesce(Vacancy.page_fetched_at, Vacancy.created_at) < now - RECHECK_EVERY,
            exists().where(UserVacancy.vacancy_id == Vacancy.id, UserVacancy.status.in_(OPEN)),
        )
        .order_by(Vacancy.page_fetched_at.nulls_first())
        .limit(RECHECK_PER_CALL)
    )
    return [{"vacancy_id": vid, "url": url} for vid, url in rows.all()]


async def recheck_vacancy(session: AsyncSession, vacancy_id: int, status: int, text: str, now: datetime) -> dict:
    v = await session.get(Vacancy, vacancy_id)
    if v is None:
        return {"archived": False}
    gone = status in (404, 410)
    page = parse.parse_vacancy(status, text) if not gone else None
    blocked = page is not None and page.error is not None and (status != 200 or "InitialState" in page.error)
    session.add(FetchLog(kind="recheck", url=v.url, http_status=status, ok=not blocked, bytes=len(text),
                         error=page.error if page else None))
    v.page_fetched_at = now
    if blocked:
        # Похоже на капчу/блок: тот же стоп, что у сбора
        until = await collect._set_stop(session, now, page.error)
        await session.commit()
        await alerts.raise_alert(session, "v2 сбор: hh", f"перепроверка: {page.error}\nСбор остановлен до {until:%H:%M} UTC.", now)
        return {"archived": False, "stop": True}
    archived = gone or bool(page and page.archived)
    if not archived:
        await session.commit()
        return {"archived": False}
    v.archived_at = now
    rows = list(await session.scalars(select(UserVacancy).where(UserVacancy.vacancy_id == v.id, UserVacancy.status.in_((*OPEN, "expired")))))
    for uv in rows:
        uv.status = "archived"
    await session.commit()
    for uv in rows:
        await cards.refresh(session, await session.get(User, uv.user_id), uv)
    return {"archived": True}


# ---------- Сводка ----------


def _key(user_id: int) -> str:
    return f"summary.{user_id}"


async def summary_text(session: AsyncSession, user: User, now: datetime) -> str:
    since = now - timedelta(days=1)
    new_cards = await session.scalar(
        select(func.count()).select_from(UserVacancy).where(UserVacancy.user_id == user.id, UserVacancy.card_at > since)
    ) or 0
    applied = await session.scalar(
        select(func.count()).select_from(UserVacancy).where(UserVacancy.user_id == user.id, UserVacancy.applied_at > since)
    ) or 0
    c = await menu.counts(session, user.id)
    lines = [
        t("summary.head"),
        t("summary.funnel", new=new_cards, waiting=c["waiting"], approved=c["approved"], maybe=c["maybe"], applied=applied),
    ]
    if c["expired"] or c["archived"]:
        lines.append(t("summary.tails", expired=c["expired"], archived=c["archived"]))
    for st in await menu.profile_stats(session, user.id, since):
        d = st.decisions
        line = t("summary.profile", label=html.escape(st.label), passed=st.passed, rejected=st.rejected,
                 apply=d["apply"], maybe=d["maybe"], skip=d["skip"])
        if st.reasons:
            line += "\n" + t("summary.reasons", reasons=", ".join(f"{html.escape(r)} {n}" for r, n in st.reasons.most_common(3)))
        lines.append(line)
    shadow = [s for s in await menu.profile_stats(session, user.id) if s.compared]
    for s in shadow:
        lines.append(t("summary.shadow", label=html.escape(s.label), agree=s.agree, compared=s.compared))
    return "\n\n".join(lines)


async def summaries(session: AsyncSession, now: datetime) -> int:
    """Сводка тем, у кого по их поясу уже 09:00, а сегодня её ещё не было. Только при работающих резюме."""
    sent = 0
    users = await session.scalars(
        select(User).where(
            User.status == "active",
            exists().where(Profile.user_id == User.id, Profile.status == "active"),
        )
    )
    for user in list(users):
        local = now.astimezone(ZoneInfo(user.tz))
        if local.hour < SUMMARY_HOUR:
            continue
        today = local.date().isoformat()
        state = await session.get(SystemState, _key(user.id))
        if state and state.value.get("date") == today:
            continue
        await session.execute(
            insert(SystemState).values(name=_key(user.id), value={"date": today}).on_conflict_do_update(
                index_elements=[SystemState.name], set_={"value": {"date": today}}
            )
        )
        await session.commit()
        await notify.send(user.tg_id, await summary_text(session, user, now), disable_notification=True)
        sent += 1
    return sent


# ---------- Чистка ----------


async def cleanup(session: AsyncSession, now: datetime) -> dict:
    """Как W6 v1: описания отработанных вакансий старше 30 дней, runs старше 90, журнал запросов старше 30."""
    old = now - timedelta(days=30)
    r1 = await session.execute(
        update(Vacancy)
        .where(
            Vacancy.created_at < old,
            Vacancy.description.is_not(None),
            ~exists().where(UserVacancy.vacancy_id == Vacancy.id, UserVacancy.status.in_(OPEN)),
        )
        .values(description=None)
        .execution_options(synchronize_session=False)
    )
    r2 = await session.execute(delete(Run).where(Run.started_at < now - timedelta(days=90)))
    r3 = await session.execute(delete(FetchLog).where(FetchLog.created_at < old))
    await session.commit()
    return {"descriptions": r1.rowcount, "runs": r2.rowcount, "fetch_log": r3.rowcount}


async def run(session: AsyncSession, now: datetime) -> dict:
    return {
        "summaries": await summaries(session, now),
        "expired": await expire(session, now),
        "cleaned": await cleanup(session, now),
        "recheck": await recheck_plan(session, now),
    }
