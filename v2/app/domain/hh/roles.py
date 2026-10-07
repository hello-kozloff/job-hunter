"""Профессиональные роли hh (параметр professional_role поиска) — все отрасли, не только IT.

Справочник — https://api.hh.ru/professional_roles (открыт без токена), снят 08.10.2026 в roles.json.
Нейросеть выбирает роли для резюме только из него; неизвестные id выбрасываются (known_roles).
"""

import json
from pathlib import Path

CATEGORIES: list[dict] = json.loads((Path(__file__).parent / "roles.json").read_text(encoding="utf-8"))
# Одна роль бывает в нескольких отраслях («Аналитик») — в словаре один раз
ROLES: dict[int, str] = {int(k): v for c in CATEGORIES for k, v in c["roles"].items()}


def catalog() -> str:
    """Справочник для промпта: строка на отрасль, «id название; …»."""
    return "\n".join(f"{c['category']}: " + "; ".join(f"{k} {v}" for k, v in c["roles"].items()) for c in CATEGORIES)


def known_roles(ids: list[int]) -> list[int]:
    return [i for i in dict.fromkeys(ids) if i in ROLES]


# Формат работы на hh (параметр work_format)
WORK_FORMATS: dict[str, str] = {
    "REMOTE": "удалённо",
    "HYBRID": "гибрид",
    "ON_SITE": "в офисе",
    "FIELD_WORK": "разъездной",
}

# Опыт на hh (параметр experience и поле workExperience)
EXPERIENCE: dict[str, str] = {
    "noExperience": "нет опыта",
    "between1And3": "1–3 года",
    "between3And6": "3–6 лет",
    "moreThan6": "более 6 лет",
}
