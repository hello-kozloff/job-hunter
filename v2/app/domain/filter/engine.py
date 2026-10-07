"""Движок правил фильтра (схема — app/domain/profile_config.py). Чистая логика, без I/O.

Вакансия — словарь с полями VacancyField (строка или список строк). Границы слова — \\w Python, он знает кириллицу
(в JS v1 это делалось руками).
"""

import re
from collections.abc import Iterable, Mapping
from functools import lru_cache

from app.domain.profile_config import Rule, Term


@lru_cache(maxsize=4096)
def compile_pattern(pattern: str) -> re.Pattern[str]:
    if pattern.startswith("re:"):
        return re.compile(pattern[3:], re.IGNORECASE)
    raw = pattern.strip()
    body = r"\w*".join(re.escape(p) for p in raw.split("*"))
    # Граница слова — только со стороны буквы: «.net» должен найтись в «ASP.NET», «c#» — в «C#/.NET»
    head = r"(?<!\w)" if raw[:1].isalnum() or raw[:1] == "_" else ""
    tail = r"(?!\w)" if raw[-1:].isalnum() or raw[-1:] in "_*" else ""
    return re.compile(head + body + tail, re.IGNORECASE)


def _text(vacancy: Mapping[str, object], field: str) -> str:
    value = vacancy.get(field)
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "\n".join(str(v) for v in value)
    return str(value)


def term_matches(term: Term, vacancy: Mapping[str, object]) -> str | None:
    """Совпавший кусок текста (для причины) или None."""
    for field in term.fields:
        text = _text(vacancy, field)
        if not text:
            continue
        for pattern in term.patterns:
            m = compile_pattern(pattern).search(text)
            if m:
                return m.group(0)
    return None


def _excepted(rule: Rule, vacancy: Mapping[str, object]) -> bool:
    return any(group and all(term_matches(t, vacancy) for t in group) for group in rule.unless)


def rule_fires(rule: Rule, vacancy: Mapping[str, object]) -> bool:
    if not rule.enabled:
        return False
    hit = any(term_matches(t, vacancy) for t in rule.match)
    fires = hit if rule.kind == "reject" else not hit
    return fires and not _excepted(rule, vacancy)


def reasons(rules: Iterable[Rule], vacancy: Mapping[str, object], stage: str) -> list[str]:
    """Причины отсева вакансии правилами одного этапа (search | page). Пусто — прошла."""
    return [r.label for r in rules if r.stage == stage and rule_fires(r, vacancy)]


def validate_patterns(rules: Iterable[Rule]) -> list[str]:
    """Ошибки в шаблонах (битые re:) — до сохранения конфига."""
    errors = []
    for r in rules:
        for term in [*r.match, *(t for g in r.unless for t in g)]:
            for p in term.patterns:
                try:
                    compile_pattern(p)
                except re.error as e:
                    errors.append(f"{r.id}: «{p}» — {e}")
    return errors
