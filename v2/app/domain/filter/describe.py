"""Правило фильтра человеческим языком (экран «🧹 Правила») и разбор команд правки правил сообщением.

Команды (одно сообщение — одна команда):
- «+ текст» — новое правило по описанию (нейросеть);
- «N текст» или «N: текст» — переписать правило N по описанию (нейросеть);
- «-N» — удалить правило N, несколько: «-2 -5» или «-2, 5».
"""

import re
from dataclasses import dataclass

from app.domain.profile_config import Rule, Term

FIELDS = {
    "title": "название",
    "skills": "навыки",
    "snippet": "фрагмент",
    "description": "описание",
    "experience": "опыт",
    "company": "компания",
}
SHOWN = 8


def _patterns(patterns: list[str]) -> str:
    shown = ", ".join(p.removeprefix("re:") for p in patterns[:SHOWN])
    return shown + (f" … +{len(patterns) - SHOWN}" if len(patterns) > SHOWN else "")


def _term(term: Term) -> str:
    return f"{'/'.join(FIELDS.get(f, f) for f in term.fields)}: {_patterns(term.patterns)}"


def describe(rule: Rule) -> str:
    """«отсечь, если в названии: java, c# · кроме: название: fullstack»."""
    terms = "; или ".join(_term(t) for t in rule.match)
    head = f"отсечь, если {terms}" if rule.kind == "reject" else f"отсечь, если НЕТ ни одного — {terms}"
    if rule.unless:
        head += " · кроме: " + "; ".join(" и ".join(_term(t) for t in group) for group in rule.unless)
    return head


@dataclass
class Command:
    action: str  # add | edit | delete
    numbers: list[int]
    text: str = ""


_DELETE = re.compile(r"^\s*-\s*\d+(\s*[,\s]\s*-?\s*\d+)*\s*$")
_EDIT = re.compile(r"^\s*(\d+)\s*[:.)=]?\s+(.+)$", re.S)


def parse_command(text: str) -> Command | None:
    text = text.strip()
    if _DELETE.match(text):
        return Command("delete", sorted({int(n) for n in re.findall(r"\d+", text)}))
    if text.startswith("+"):
        body = text[1:].strip()
        return Command("add", [], body) if body else None
    m = _EDIT.match(text)
    if m:
        return Command("edit", [int(m.group(1))], m.group(2).strip())
    return None
