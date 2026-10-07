"""Разбор страниц hh.ru — порт v1 1:1 (n8n/w1-collector/parse-search.js, parse-vacancy.js, n8n/shared/hh.js).

Источник данных — JSON `<template id="HH-Lux-InitialState">` (HTML-сущности раскодируются за один проход),
не разметка data-qa: в разметке только ~20 карточек из 100. Любое отклонение от ожидаемой структуры —
поломка (капча, блок, новая вёрстка): сбор останавливается, админу — тревога.
"""

import html
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

_TEMPLATE = re.compile(r'<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)</template>')


def _state(text: str) -> tuple[dict | None, str | None]:
    m = _TEMPLATE.search(text)
    if not m:
        # Слово «captcha» есть и на нормальной странице — смотрим на него только без InitialState
        hint = "похоже на капчу/блок" if re.search(r"captcha|робот", text, re.I) else "сменилась вёрстка?"
        return None, f"нет HH-Lux-InitialState — {hint}"
    try:
        # html.unescape — один проход, как decodeEntities в v1: &amp;quot; → &quot;, а не кавычка
        return json.loads(html.unescape(m.group(1))), None
    except json.JSONDecodeError as e:
        return None, f"InitialState не разбирается: {e}"


def _strip_tags(s: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", str(s or ""))).strip()


def norm_title(s: str) -> str:
    s = s.lower().replace("ё", "е")
    return re.sub(r"[^a-zа-я0-9+#]+", " ", s).strip()


def _contract(v: dict) -> list[str]:
    civil = []
    for c in v.get("civilLawContracts") or []:
        if isinstance(c, dict):
            civil.extend(c.get("civilLawContractsElement") or [])
        elif isinstance(c, str):
            civil.append(c)
    return (["tk"] if v.get("acceptLaborContract") else []) + [str(c).lower() for c in civil]


def _published(v: dict) -> datetime | None:
    raw = (v.get("publicationTime") or {}).get("$")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


@dataclass
class Record:
    """Вакансия из выдачи → поля таблицы vacancies."""

    external_id: str
    dup_key: str
    title: str
    company: str
    company_id: str | None
    areas: list[str]
    salary_from: int | None
    salary_to: int | None
    currency: str | None
    salary_gross: bool | None
    experience: str | None
    employment_form: str | None
    work_formats: list[str]
    languages: list[str]
    key_skills: list[str]
    contract: list[str]
    has_test: bool
    letter_required: bool
    responses: int | None
    snippet: str
    url: str
    apply_url: str
    published_at: datetime | None
    source: str = "hh"
    apply_type: str = "hh"

    def filter_view(self) -> dict[str, Any]:
        """Поля для правил фильтра на этапе выдачи."""
        return {
            "title": self.title,
            "skills": self.key_skills,
            "snippet": self.snippet,
            "experience": self.experience or "",
            "company": self.company,
        }


def to_record(v: dict) -> Record:
    pay = v.get("compensation") or {}
    company = v.get("company") or {}
    company_id = str(company["id"]) if company.get("id") else None
    vid = str(v["vacancyId"])
    snippet = v.get("snippet") or {}
    skills = _strip_tags(snippet.get("skill"))
    return Record(
        external_id=vid,
        # Одна вакансия в разных регионах = разные id. Склеиваем по компании и названию; скрытые компании — нет
        dup_key=f"hh:{company_id}:{norm_title(str(v['name']))}" if company_id else f"hh:id:{vid}",
        title=str(v["name"]).strip(),
        company=str(company.get("visibleName") or company.get("name") or "").strip(),
        company_id=company_id,
        areas=[a for a in [(v.get("area") or {}).get("name")] if a],
        salary_from=pay.get("from"),
        salary_to=pay.get("to"),
        currency=pay.get("currencyCode"),
        salary_gross=pay.get("gross") if isinstance(pay.get("gross"), bool) else None,
        experience=v.get("workExperience") or None,
        employment_form=v.get("employmentForm") or None,
        work_formats=[e for w in v.get("workFormats") or [] for e in (w.get("workFormatsElement") or [])],
        languages=[f"{l.get('isoCode')}:{l.get('degree')}" for x in v.get("languages") or [] for l in (x.get("language") or [])],
        key_skills=[s.strip() for s in skills.split(",") if s.strip()],
        contract=_contract(v),
        has_test=bool(v.get("userTestPresent")),
        letter_required=bool(v.get("@responseLetterRequired")),
        responses=v.get("totalResponsesCount"),
        snippet=" | ".join(x for x in (_strip_tags(snippet.get(k)) for k in ("req", "resp", "cond")) if x)[:1500],
        url=f"https://hh.ru/vacancy/{vid}",
        apply_url=f"https://hh.ru/applicant/vacancy_response?vacancyId={vid}",
        published_at=_published(v),
    )


@dataclass
class SearchPage:
    ok: bool
    reason: str = ""
    total: int | None = None
    count: int = 0
    records: list[Record] = field(default_factory=list)


def parse_search(status: int, text: str, location: str | None = None) -> SearchPage:
    """Страница выдачи /search/vacancy. Дубли по dup_key склеиваются (регионы — в areas)."""
    if status != 200:
        return SearchPage(False, f"hh ответил HTTP {status}" + (f" → {location}" if location else ""))
    state, error = _state(text)
    if error:
        return SearchPage(False, error)
    result = (state or {}).get("vacancySearchResult") or {}
    items = result.get("vacancies")
    if not isinstance(items, list):
        return SearchPage(False, "нет vacancySearchResult.vacancies — сменилась структура")
    by_key: dict[str, Record] = {}
    seen: set[str] = set()
    for v in items:
        if not v or not v.get("vacancyId") or not v.get("name"):
            return SearchPage(False, "у вакансии нет vacancyId/name — сменилась структура")
        vid = str(v["vacancyId"])
        if vid in seen:
            continue
        seen.add(vid)
        rec = to_record(v)
        prev = by_key.get(rec.dup_key)
        if prev is None:
            by_key[rec.dup_key] = rec
        else:
            prev.areas.extend(a for a in rec.areas if a not in prev.areas)
    # В отличие от v1, пустая выдача — норма: у узкой профессии за сутки может не быть вакансий.
    # Поломку вёрстки ловят проверки выше (нет InitialState / vacancySearchResult)
    return SearchPage(True, total=result.get("totalResults"), count=len(items), records=list(by_key.values()))


def html_to_text(s: str) -> str:
    s = re.sub(r"<\s*(br|/p|/li|/h\d|/div)[^>]*>", "\n", str(s or ""), flags=re.I)
    s = re.sub(r"<li[^>]*>", "• ", s, flags=re.I)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    s = re.sub(r"[ \t ]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n", s).strip()


@dataclass
class VacancyPage:
    error: str | None = None
    vacancy_id: str | None = None
    description: str = ""
    key_skills: list[str] = field(default_factory=list)
    has_test: bool | None = None
    contract: list[str] = field(default_factory=list)
    archived: bool = False


def parse_vacancy(status: int, text: str) -> VacancyPage:
    """Страница /vacancy/<id>. Ошибка — не поломка сбора: вакансию оценят по фрагменту из выдачи (как в v1)."""
    if status != 200:
        return VacancyPage(error=f"страница: HTTP {status}")
    state, error = _state(text)
    if error:
        return VacancyPage(error=f"страница: {error}")
    v = (((state or {}).get("vacancyView") or {}).get("vacancyFull") or {}).get("vacancy") or {}
    if not v.get("description"):
        return VacancyPage(error="страница: нет описания")
    vid = str(v.get("vacancyId"))
    test = (((state or {}).get("applicantVacancyResponseStatuses") or {}).get(vid) or {}).get("test") or {}
    return VacancyPage(
        vacancy_id=vid,
        description=html_to_text(v["description"])[:8000],
        key_skills=[str(s) for s in v.get("keySkills") or []],
        has_test=bool(test.get("hasTests")) if test else None,
        contract=_contract(v),
        archived=bool((v.get("status") or {}).get("archived") or v.get("closedForApplicants")),
    )
