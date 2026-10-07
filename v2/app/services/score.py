"""Оценка вакансий нейросетью (порт W2 v1): совпадения, прошедшие фильтр → apply / maybe / skip → карточки.

Вызывает n8n v2 («V2 Collect», шаг Score) после каждого сбора и по расписанию — доедает остаток.
Совпадение захватывается одним UPDATE (как Claim в v1): параллельный вызов те же строки не возьмёт; зависший захват
освобождается через 30 мин. Оцениваются только свежие (3 дня, как срок карточки в v1) совпадения работающих резюме.
"""

import asyncio
import logging
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Match, Profile, ProfileConfig as ConfigRow, Resume, User, Vacancy
from app.domain import resume_text, timezones
from app.domain.llm import score as prompts
from app.domain.profile_config import ProfileConfig
from app.services import alerts, cards, llm

log = logging.getLogger(__name__)

CLAIM_TTL = timedelta(minutes=30)
FRESH = timedelta(days=3)


def _scorable(now: datetime):
    return (
        Match.filter_status == "passed",
        Match.decision.is_(None),
        or_(Match.scoring_at.is_(None), Match.scoring_at < now - CLAIM_TTL),
        Match.created_at > now - FRESH,
        Profile.status == "active",
        User.status == "active",
    )


def _base(now: datetime):
    return (
        select(Match.id)
        .join(Profile, Profile.id == Match.profile_id)
        .join(User, User.id == Profile.user_id)
        .where(*_scorable(now))
    )


async def remaining(session: AsyncSession, now: datetime) -> int:
    return await session.scalar(select(func.count()).select_from(_base(now).subquery())) or 0


async def claim(session: AsyncSession, now: datetime) -> int | None:
    """Захватить одно совпадение на оценку (старые — первыми)."""
    pick = _base(now).order_by(Match.id).limit(1).with_for_update(of=Match, skip_locked=True).scalar_subquery()
    mid = await session.scalar(
        update(Match)
        .where(Match.id == pick, or_(Match.scoring_at.is_(None), Match.scoring_at < now - CLAIM_TTL))
        .values(scoring_at=now)
        .returning(Match.id)
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    return mid


def model_name(provider: str) -> str:
    s = get_settings()
    return s.claude_model if provider == "claude" else s.gemini_model


async def score_one(session: AsyncSession, match_id: int, now: datetime) -> None:
    """Оценить захваченное совпадение и доставить карточку. LlmUnavailable — наружу (совпадение освобождено)."""
    m = await session.get(Match, match_id, populate_existing=True)
    profile = await session.get(Profile, m.profile_id)
    user = await session.get(User, profile.user_id)
    v = await session.get(Vacancy, m.vacancy_id)
    row = await session.get(ConfigRow, profile.active_config_id)
    config = ProfileConfig.model_validate(row.config)
    resume = await session.scalar(select(Resume).where(Resume.profile_id == profile.id).order_by(Resume.id.desc()).limit(1))
    system = prompts.system_prompt(
        config.llm,
        resume.structured if resume else {},
        resume_text.strip_contacts(resume.raw_text) if resume else profile.title,
        timezones.describe(user.tz, now),
    )
    provider = config.llm.provider
    try:
        verdict = await llm.ask(
            session,
            kind="score",
            system=system,
            prompt=prompts.vacancy_text(v),
            schema=prompts.Verdict,
            provider=provider,
            user_id=user.id,
            profile_id=profile.id,
            temperature=0,
        )
        decision, reason = verdict.decision, verdict.reason.strip()[:300]
    except llm.LlmUnavailable:
        m.scoring_at = None
        await session.commit()
        raise
    except llm.LlmError as e:
        # Ответ не по схеме: карточка с ⚠️, решает пользователь (как в v1)
        decision, reason = "error", str(e)[:300]
    m.decision, m.llm_reason, m.llm_model = decision, reason, model_name(provider)
    m.config_id, m.scored_at = row.id, now
    await session.commit()
    await cards.deliver(session, user.id, v.id, now)


async def run(session: AsyncSession, budget: float = 100, pause: float = 4) -> dict:
    """Оценивать по одной, пока есть что и пока не вышло время (n8n ждёт ответа). pause — между запросами к нейросети:
    бесплатный Gemini даёт ~15 запросов в минуту на всех."""
    deadline = time.monotonic() + budget
    scored, stopped = 0, None
    while time.monotonic() < deadline:
        now = datetime.now(UTC)
        mid = await claim(session, now)
        if mid is None:
            break
        try:
            await score_one(session, mid, now)
        except llm.LlmUnavailable as e:
            stopped = e.quota or "unavailable"
            if e.quota != "minute":
                # Суточный лимит или провайдер лежит — админу тревога; минутный лимит пройдёт сам к следующему вызову
                await alerts.raise_alert(session, "v2 оценка: нейросеть", f"{e} — оценка продолжится позже", now)
            break
        scored += 1
        await asyncio.sleep(pause)
    now = datetime.now(UTC)
    if scored and stopped is None:
        await alerts.resolve(session, "v2 оценка")
    return {"scored": scored, "remaining": await remaining(session, now), "stopped": stopped}
