"""Профили (резюме) пользователя: создание из текста резюме через черновик нейросети, версии настроек, правка.

Все функции, принимающие profile_id от пользователя, проверяют владельца (get_owned) — чужой профиль = None.
"""

import re
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Profile, ProfileConfig as ConfigRow, Resume, User
from app.domain import resume_text
from app.domain.filter.engine import validate_patterns
from app.domain.hh.roles import known_roles
from app.domain.llm import draft as prompts
from app.domain.profile_config import LetterConfig, ProfileConfig, Rule
from app.services import llm


@dataclass
class Loaded:
    profile: Profile
    config: ProfileConfig
    version: int
    headline: str


async def list_for_user(session: AsyncSession, user_id: int) -> list[Profile]:
    return list(await session.scalars(select(Profile).where(Profile.user_id == user_id).order_by(Profile.id)))


async def get_owned(session: AsyncSession, user_id: int, profile_id: int) -> Profile | None:
    return await session.scalar(select(Profile).where(Profile.id == profile_id, Profile.user_id == user_id))


async def load(session: AsyncSession, user_id: int, profile_id: int) -> Loaded | None:
    profile = await get_owned(session, user_id, profile_id)
    if profile is None or profile.active_config_id is None:
        return None
    row = await session.get(ConfigRow, profile.active_config_id)
    resume = await session.scalar(
        select(Resume).where(Resume.profile_id == profile.id).order_by(Resume.id.desc()).limit(1)
    )
    headline = (resume.structured or {}).get("headline", profile.title) if resume else profile.title
    return Loaded(profile, ProfileConfig.model_validate(row.config), row.version, headline)


def _unique_rule_ids(rules: list[Rule]) -> list[Rule]:
    seen: set[str] = set()
    out = []
    for r in rules:
        # id уходит в callback_data кнопки: только [a-z0-9_], коротко
        base = re.sub(r"[^a-z0-9_]", "_", (r.id or "rule").lower())[:20] or "rule"
        rid, n = base, 2
        while rid in seen:
            rid, n = f"{base}_{n}", n + 1
        seen.add(rid)
        out.append(r.model_copy(update={"id": rid}))
    return out


def _check(config: ProfileConfig) -> ProfileConfig:
    config.search.roles = known_roles(config.search.roles)
    config.filter.rules = _unique_rule_ids(config.filter.rules)
    errors = validate_patterns(config.filter.rules)
    if errors:
        raise llm.LlmError("нейросеть написала битое правило: " + "; ".join(errors[:3]))
    return config


async def save_version(
    session: AsyncSession, profile: Profile, config: ProfileConfig, created_by: str, comment: str | None = None
) -> int:
    version = (
        await session.scalar(select(func.max(ConfigRow.version)).where(ConfigRow.profile_id == profile.id)) or 0
    ) + 1
    row = ConfigRow(
        profile_id=profile.id, version=version, config=config.model_dump(mode="json"), created_by=created_by, comment=comment
    )
    session.add(row)
    await session.flush()
    profile.active_config_id = row.id
    await session.commit()
    return version


async def create_from_text(session: AsyncSession, user: User, source: str, source_ref: str | None, text: str) -> Profile:
    """Резюме → нейросеть (разбор + черновик настроек) → профиль-черновик с версией настроек 1."""
    text = resume_text.check_length(text)
    draft = await llm.ask(
        session,
        kind="draft",
        system=prompts.DRAFT_SYSTEM,
        prompt=prompts.draft_prompt(resume_text.strip_contacts(text)),
        schema=prompts.Draft,
        user_id=user.id,
    )
    tg = resume_text.find_telegram(text) or (f"@{user.username}" if user.username else "")
    config = _check(
        ProfileConfig(
            search=draft.search,
            filter=draft.filter,
            llm=draft.llm,
            letter=LetterConfig(contact=f"тг: {tg}" if tg else "", signature=user.first_name or ""),
        )
    )
    profile = Profile(user_id=user.id, title=draft.title[:64], emoji=(draft.emoji or "📄")[:8])
    session.add(profile)
    await session.flush()
    session.add(
        Resume(
            profile_id=profile.id,
            source=source,
            source_ref=source_ref,
            raw_text=text,
            structured=draft.resume.model_dump(mode="json"),
        )
    )
    await save_version(session, profile, config, created_by="llm", comment="черновик по резюме")
    return profile


async def propose_edit(session: AsyncSession, user: User, loaded: Loaded, request: str) -> prompts.ConfigEdit:
    """Правка текстом: нейросеть возвращает новые настройки и список изменений. Не сохраняет."""
    edit = await llm.ask(
        session,
        kind="rule",
        system=prompts.EDIT_SYSTEM,
        prompt=prompts.edit_prompt(loaded.config, loaded.headline, request),
        schema=prompts.ConfigEdit,
        user_id=user.id,
        profile_id=loaded.profile.id,
    )
    if not edit.question:
        _check(loaded.config.model_copy(update={"search": edit.search, "filter": edit.filter, "llm": edit.llm}))
    return edit


async def apply_edit(session: AsyncSession, loaded: Loaded, edit: prompts.ConfigEdit, comment: str) -> int:
    config = _check(loaded.config.model_copy(update={"search": edit.search, "filter": edit.filter, "llm": edit.llm}))
    return await save_version(session, loaded.profile, config, created_by="user", comment=comment[:500])


async def toggle_rule(session: AsyncSession, loaded: Loaded, rule_id: str) -> int | None:
    rules = loaded.config.filter.rules
    if not any(r.id == rule_id for r in rules):
        return None
    loaded.config.filter.rules = [r.model_copy(update={"enabled": not r.enabled}) if r.id == rule_id else r for r in rules]
    return await save_version(session, loaded.profile, loaded.config, created_by="user", comment=f"правило {rule_id}")


async def set_status(session: AsyncSession, profile: Profile, status: str) -> None:
    profile.status = status
    await session.commit()


async def set_shadow(session: AsyncSession, profile: Profile, shadow: bool) -> None:
    profile.shadow = shadow
    await session.commit()


async def delete(session: AsyncSession, profile: Profile) -> None:
    await session.delete(profile)
    await session.commit()
