"""Настройки резюме (профиля): поиск, фильтр, нейросеть, письма, расписание. Хранятся версиями в profile_configs.

Схема плоская (без рекурсии): её же нейросеть выдаёт как JSON при черновике и правке текстом.

Правило фильтра:
- kind="reject" — отсечь, если совпал любой терм из `match` и не сработало исключение;
- kind="require" — отсечь, если не совпал ни один терм из `match` и не сработало исключение;
- `unless` — исключения: список групп, группа срабатывает, если совпали ВСЕ её термы.
Терм — поля вакансии и шаблоны: совпадение любого шаблона в любом из полей.
Шаблон — слово целиком без учёта регистра, «*» — любое окончание («тестировщ*»), «re:…» — регулярное выражение.
"""

from typing import Literal

from pydantic import BaseModel, Field

VacancyField = Literal["title", "skills", "description", "snippet", "experience", "company"]


class Term(BaseModel):
    fields: list[VacancyField]
    patterns: list[str]


class Rule(BaseModel):
    id: str = Field(description="короткий латинский id в snake_case, уникальный в профиле")
    label: str = Field(description="причина отсева для пользователя, по-русски, 1–4 слова")
    stage: Literal["search", "page"] = Field(
        description="search — по выдаче (название, навыки, фрагмент, опыт); page — нужен полный текст описания"
    )
    kind: Literal["reject", "require"]
    match: list[Term]
    unless: list[list[Term]] = Field(default_factory=list)
    enabled: bool = True


class Case(BaseModel):
    case: str
    decision: Literal["apply", "maybe", "skip"]


class SearchConfig(BaseModel):
    anywhere: list[str] = Field(description="слова поиска по всему тексту вакансии (через OR)")
    in_name: list[str] = Field(description="слова поиска только в названии (через OR)")
    roles: list[int] = Field(description="id профессиональных ролей hh")
    work_format: list[Literal["REMOTE", "HYBRID", "ON_SITE", "FIELD_WORK"]] = Field(default_factory=lambda: ["REMOTE"])
    education_not_required: bool = Field(
        default=False, description="true, если у кандидата нет высшего образования — искать без требования диплома"
    )
    period: int = Field(default=1, description="за сколько дней искать: 1, 3 или 7")


class FilterConfig(BaseModel):
    max_responses: int = Field(default=3000, description="отсечь вакансии с большим числом откликов; 0 — не отсекать")
    only_rf: bool = Field(default=True, description="отсекать вакансии «только для находящихся в РФ»")
    rules: list[Rule]


class LlmConfig(BaseModel):
    apply: list[str] = Field(description="когда откликаться: короткие критерии")
    maybe: list[str] = Field(description="когда решает сам кандидат")
    skip: list[str] = Field(description="когда пропускать")
    cases: list[Case] = Field(default_factory=list, description="спорные случаи и решения по ним")
    provider: Literal["gemini", "claude"] = "gemini"


class LetterConfig(BaseModel):
    samples: list[str] = Field(default_factory=list)
    signature: str = ""
    contact: str = ""
    notes: list[str] = Field(default_factory=list)


class ScheduleConfig(BaseModel):
    day_every: int = 30
    night_every: int = 120
    day_window: str = "07-18"
    paused: bool = False


class ProfileConfig(BaseModel):
    search: SearchConfig
    filter: FilterConfig
    llm: LlmConfig
    letter: LetterConfig = Field(default_factory=LetterConfig)
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
