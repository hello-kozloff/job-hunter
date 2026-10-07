"""Схема Postgres v2 (docs/v2/architecture.md → «Модель данных»).

Общий пул: vacancies, searches, fetch_log, runs — без владельца, одна вакансия hh = одна строка.
Пользовательское: всё, что ниже users, — через user_id или profile_id (профиль = резюме пользователя).
Статусы и виды — строки; допустимые значения проверяет код (domain), не CHECK в базе.
Новая колонка → правка здесь + `alembic revision --autogenerate`.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Имена ограничений — стабильные, чтобы autogenerate и downgrade работали предсказуемо
NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)
    type_annotation_map = {dict[str, Any]: JSONB, list[Any]: JSONB, datetime: DateTime(timezone=True)}


def created_col() -> Mapped[datetime]:
    return mapped_column(server_default=func.now())


def updated_col() -> Mapped[datetime]:
    return mapped_column(server_default=func.now(), onupdate=func.now())


# ---------- Пользователи и доступ ----------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    tg_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str | None] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(16), default="user", server_default="user")  # admin | user
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")  # active | blocked
    tz: Mapped[str] = mapped_column(String(64), default="Europe/Moscow", server_default="Europe/Moscow")
    invited_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    invite_id: Mapped[int | None] = mapped_column(ForeignKey("invites.id", ondelete="SET NULL", use_alter=True))
    # Квоты (пусто — без лимитов): {"profiles": 3, "scores_per_day": 100, "letters_per_day": 20}
    limits: Mapped[dict[str, Any]] = mapped_column(default=dict, server_default="{}")
    onboarded_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    max_uses: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    used: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    expires_at: Mapped[datetime | None]
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_col()


class AccessRequest(Base):
    __tablename__ = "access_requests"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    tg_id: Mapped[int] = mapped_column(BigInteger, index=True)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str | None] = mapped_column(String(128))
    text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")  # pending|approved|rejected
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_col()


# ---------- Профили (резюме) и их настройки ----------


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(64))
    emoji: Mapped[str] = mapped_column(String(8), default="📄", server_default="📄")
    status: Mapped[str] = mapped_column(String(16), default="draft", server_default="draft")  # draft|active|paused
    # Теневой режим: карточки и на skip (выкл — skip только в сводке)
    shadow: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    active_config_id: Mapped[int | None] = mapped_column(
        ForeignKey("profile_configs.id", ondelete="SET NULL", use_alter=True)
    )
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(16))  # hh | file | text
    source_ref: Mapped[str | None] = mapped_column(Text)  # ссылка hh или имя файла
    raw_text: Mapped[str] = mapped_column(Text)
    # Разбор нейросетью: навыки (коммерческие / пет-проекты), опыт, без контактов
    structured: Mapped[dict[str, Any]] = mapped_column(default=dict, server_default="{}")
    created_at: Mapped[datetime] = created_col()


class ProfileConfig(Base):
    """Версия настроек профиля (поиск, фильтр, нейросеть, письма, расписание). Оценка ссылается на версию."""

    __tablename__ = "profile_configs"
    __table_args__ = (UniqueConstraint("profile_id", "version"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    config: Mapped[dict[str, Any]]
    created_by: Mapped[str] = mapped_column(String(16))  # llm | user | import
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_col()


class Blacklist(Base):
    __tablename__ = "blacklist"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    company: Mapped[str | None] = mapped_column(String(256))
    company_id: Mapped[str | None] = mapped_column(String(32))
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_col()


# ---------- Общий пул вакансий ----------


class Vacancy(Base):
    __tablename__ = "vacancies"
    __table_args__ = (UniqueConstraint("source", "external_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source: Mapped[str] = mapped_column(String(16), default="hh", server_default="hh")
    external_id: Mapped[str] = mapped_column(String(32))
    # hh:<company_id>:<нормализованное название> или hh:id:<id> у скрытой компании
    dup_key: Mapped[str] = mapped_column(String(320), index=True)
    title: Mapped[str] = mapped_column(Text)
    company: Mapped[str | None] = mapped_column(String(256))
    company_id: Mapped[str | None] = mapped_column(String(32))
    areas: Mapped[list[Any]] = mapped_column(default=list, server_default="[]")
    salary_from: Mapped[int | None] = mapped_column(Integer)
    salary_to: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str | None] = mapped_column(String(8))
    salary_gross: Mapped[bool | None] = mapped_column(Boolean)
    experience: Mapped[str | None] = mapped_column(String(32))
    employment_form: Mapped[str | None] = mapped_column(String(32))
    work_formats: Mapped[list[Any]] = mapped_column(default=list, server_default="[]")
    languages: Mapped[list[Any]] = mapped_column(default=list, server_default="[]")
    key_skills: Mapped[list[Any]] = mapped_column(default=list, server_default="[]")
    has_test: Mapped[bool | None] = mapped_column(Boolean)
    letter_required: Mapped[bool | None] = mapped_column(Boolean)
    responses: Mapped[int | None] = mapped_column(Integer)
    snippet: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text)
    apply_url: Mapped[str | None] = mapped_column(Text)
    apply_type: Mapped[str | None] = mapped_column(String(16))  # hh | external | manual
    contract: Mapped[list[Any]] = mapped_column(default=list, server_default="[]")
    published_at: Mapped[datetime | None]
    # Страница вакансии: none — ещё не грузили, ok, error (оценка по фрагменту)
    description: Mapped[str | None] = mapped_column(Text)
    page_status: Mapped[str] = mapped_column(String(8), default="none", server_default="none")
    page_error: Mapped[str | None] = mapped_column(Text)
    page_fetched_at: Mapped[datetime | None]
    archived_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class Search(Base):
    """Уникальный поисковый запрос: одинаковые URL разных профилей склеиваются."""

    __tablename__ = "searches"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    url_hash: Mapped[str] = mapped_column(String(64), unique=True)
    url: Mapped[str] = mapped_column(Text)
    last_run_at: Mapped[datetime | None]
    next_due_at: Mapped[datetime | None] = mapped_column(index=True)
    created_at: Mapped[datetime] = created_col()


class ProfileSearch(Base):
    __tablename__ = "profile_searches"

    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    search_id: Mapped[int] = mapped_column(ForeignKey("searches.id", ondelete="CASCADE"), primary_key=True)


class FetchLog(Base):
    """Каждый запрос к hh: глобальный бюджет и здоровье в /admin."""

    __tablename__ = "fetch_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # search | vacancy | recheck | resume
    url: Mapped[str] = mapped_column(Text)
    http_status: Mapped[int | None] = mapped_column(Integer)
    ok: Mapped[bool] = mapped_column(Boolean)
    bytes: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # schedule | bot | manual | trial
    status: Mapped[str] = mapped_column(String(16), default="running", server_default="running")  # running|ok|error
    stats: Mapped[dict[str, Any]] = mapped_column(default=dict, server_default="{}")
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)
    finished_at: Mapped[datetime | None]


# ---------- Совпадения и карточки ----------


class Match(Base):
    """Вакансия глазами одного профиля: фильтр и оценка нейросети."""

    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("profile_id", "vacancy_id"),
        Index("ix_matches_state", "filter_status", "decision"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"))
    vacancy_id: Mapped[int] = mapped_column(ForeignKey("vacancies.id", ondelete="CASCADE"), index=True)
    # search_passed → passed (прошла и страницу) | rejected (+ reasons)
    filter_status: Mapped[str] = mapped_column(String(16))
    reasons: Mapped[list[Any]] = mapped_column(default=list, server_default="[]")
    # apply | maybe | skip | error; scoring_at — захват на оценку (как Claim в v1)
    decision: Mapped[str | None] = mapped_column(String(8))
    llm_reason: Mapped[str | None] = mapped_column(Text)
    llm_model: Mapped[str | None] = mapped_column(String(64))
    config_id: Mapped[int | None] = mapped_column(ForeignKey("profile_configs.id", ondelete="SET NULL"))
    scoring_at: Mapped[datetime | None]
    scored_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class UserVacancy(Base):
    """Карточка вакансии у пользователя: одна на все его профили, решение и письмо."""

    __tablename__ = "user_vacancies"
    __table_args__ = (UniqueConstraint("user_id", "vacancy_id"), Index("ix_user_vacancies_status", "user_id", "status"))

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    vacancy_id: Mapped[int] = mapped_column(ForeignKey("vacancies.id", ondelete="CASCADE"))
    # waiting → approved | maybe | skipped → applied; expired, archived
    status: Mapped[str] = mapped_column(String(16), default="waiting", server_default="waiting")
    my_decision: Mapped[str | None] = mapped_column(String(8))  # apply | maybe | skip | earlier
    my_reason: Mapped[str | None] = mapped_column(Text)
    chosen_profile_id: Mapped[int | None] = mapped_column(ForeignKey("profiles.id", ondelete="SET NULL"))
    letter: Mapped[str | None] = mapped_column(Text)
    letter_notes: Mapped[list[Any]] = mapped_column(default=list, server_default="[]")
    letter_lock: Mapped[datetime | None]
    tg_card_id: Mapped[int | None] = mapped_column(BigInteger)
    tg_ask_id: Mapped[int | None] = mapped_column(BigInteger)
    tg_letter_id: Mapped[int | None] = mapped_column(BigInteger)
    card_at: Mapped[datetime | None]
    applied_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


# ---------- Служебное ----------


class LlmUsage(Base):
    __tablename__ = "llm_usage"
    __table_args__ = (Index("ix_llm_usage_user_day", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    profile_id: Mapped[int | None] = mapped_column(ForeignKey("profiles.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(16))  # score | letter | draft | rule | resume
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(64))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    ok: Mapped[bool] = mapped_column(Boolean)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_col()


class Alert(Base):
    """Тревоги админу (как W4 v1): повтор той же ошибки правит открытую тревогу."""

    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alerts_open", "alert_key", "is_open"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    alert_key: Mapped[str] = mapped_column(String(256))
    source: Mapped[str] = mapped_column(String(64))  # n8n:<workflow> | api | bot
    message: Mapped[str] = mapped_column(Text)
    hits: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    is_open: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    tg_message_id: Mapped[int | None] = mapped_column(BigInteger)
    first_at: Mapped[datetime] = created_col()
    last_at: Mapped[datetime] = created_col()


class SystemState(Base):
    """Глобальные флаги: стоп сбора по капче, бюджет hh и т. п. (name → value)."""

    __tablename__ = "system_state"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(default=dict, server_default="{}")
    updated_at: Mapped[datetime] = updated_col()
