"""Встроенные проверки фильтра (не правила DSL): «только из РФ», чёрный список, порог откликов.

Порт v1: RF_ONLY — n8n/w1-collector/parse-vacancy.js, нормализация компании — filter-search.js.
"""

import re

RF_ONLY = [
    re.compile(r"(только|исключительно)[^.\n]{0,40}(из|на территории|в|по)\s+(рф|росси)", re.I),
    re.compile(
        r"(находит[а-яё]*|проживать|проживани[а-яё]*|нахождени[а-яё]*|располож[а-яё]*)[^.\n]{0,30}"
        r"(в|на территории|из)\s+(рф|росси)",
        re.I,
    ),
    re.compile(r"(налогов[а-яё]*\s+)?резидент[а-яё]*\s+(рф|росси)", re.I),
    re.compile(r"(based|located|reside\w*|living)\s+in\s+russia", re.I),
]


def only_rf(description: str) -> str | None:
    """Совпавший кусок «только из РФ» (пишется в причину, чтобы ложные срабатывания было видно) или None."""
    for pattern in RF_ONLY:
        m = pattern.search(description or "")
        if m:
            return m.group(0).strip()
    return None


# Форму организации не сравниваем: страница пишет «ООО ОнТаргет ЛАБС», выдача — «ОнТаргет ЛАБС»
_ORG_FORM = re.compile(
    r"^(ооо|оао|зао|пао|ао|нао|ип|тоо|нко|ано|гуп|муп|фгуп|гку|гбу|llc|ltd|inc)\.?\s+"
    r"|\s+(ооо|оао|зао|пао|ао|нао|ип|тоо|llc|ltd|inc)\.?$"
)


def norm_company(name: str | None) -> str:
    s = re.sub(r"\s+", " ", str(name or "").strip()).lower()
    return _ORG_FORM.sub("", s)


def in_blacklist(company: str | None, company_id: str | None, names: set[str], ids: set[str]) -> bool:
    return bool((norm_company(company) and norm_company(company) in names) or (company_id and company_id in ids))
