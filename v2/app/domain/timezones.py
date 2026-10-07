"""Часовой пояс пользователя: кнопки популярных и разбор того, что ввели руками.

От пояса зависят тихие часы, утренняя сводка и «работа ночью» в промпте оценки.
"""

import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

# Кнопки онбординга: (подпись, IANA). Порядок — как на экране
POPULAR: list[tuple[str, str]] = [
    ("Москва", "Europe/Moscow"),
    ("Калининград", "Europe/Kaliningrad"),
    ("Екатеринбург", "Asia/Yekaterinburg"),
    ("Новосибирск", "Asia/Novosibirsk"),
    ("Минск", "Europe/Minsk"),
    ("Алматы", "Asia/Almaty"),
    ("Ташкент", "Asia/Tashkent"),
    ("Тбилиси", "Asia/Tbilisi"),
    ("Ереван", "Asia/Yerevan"),
    ("Белград", "Europe/Belgrade"),
    ("Бангкок", "Asia/Bangkok"),
    ("Бали", "Asia/Makassar"),
]

# Города, которые пишут словом (в нижнем регистре) → IANA
CITIES: dict[str, str] = {name.lower(): tz for name, tz in POPULAR} | {
    "мск": "Europe/Moscow",
    "питер": "Europe/Moscow",
    "санкт-петербург": "Europe/Moscow",
    "спб": "Europe/Moscow",
    "самара": "Europe/Samara",
    "омск": "Asia/Omsk",
    "красноярск": "Asia/Krasnoyarsk",
    "иркутск": "Asia/Irkutsk",
    "владивосток": "Asia/Vladivostok",
    "астана": "Asia/Almaty",
    "бишкек": "Asia/Bishkek",
    "баку": "Asia/Baku",
    "стамбул": "Europe/Istanbul",
    "тель-авив": "Asia/Jerusalem",
    "дубай": "Asia/Dubai",
    "пхукет": "Asia/Bangkok",
    "паттайя": "Asia/Bangkok",
    "лиссабон": "Europe/Lisbon",
    "берлин": "Europe/Berlin",
    "варшава": "Europe/Warsaw",
    "лондон": "Europe/London",
    "нью-йорк": "America/New_York",
}

_OFFSET = re.compile(r"^(?:utc|gmt|мск)?\s*([+-])\s*(\d{1,2})$", re.IGNORECASE)
_ZONES_LOWER = {z.lower(): z for z in available_timezones()}


def parse_tz(text: str) -> str | None:
    """«Asia/Bangkok», «бангкок», «+7», «UTC+7», «мск+4» → имя IANA; не разобрали — None."""
    raw = text.strip()
    low = raw.lower()
    if low in CITIES:
        return CITIES[low]
    if low.replace(" ", "_") in _ZONES_LOWER:
        return _ZONES_LOWER[low.replace(" ", "_")]
    m = _OFFSET.match(low.replace(" ", ""))
    if m:
        sign, hours = m.group(1), int(m.group(2))
        if low.startswith("мск"):
            hours = hours + 3 if sign == "+" else 3 - hours
            sign = "+" if hours >= 0 else "-"
            hours = abs(hours)
        if hours > 14:
            return None
        if hours == 0:
            return "Etc/UTC"
        # В зонах Etc/GMT знак обратный: UTC+7 = Etc/GMT-7
        return f"Etc/GMT{'-' if sign == '+' else '+'}{hours}"
    return None


def describe(tz: str, now: datetime | None = None) -> str:
    """«Бангкок (UTC+7)» для известных, иначе «Asia/Bangkok (UTC+7)»."""
    zone = ZoneInfo(tz)
    offset = (now or datetime.now(zone)).astimezone(zone).utcoffset()
    minutes = int(offset.total_seconds() // 60) if offset else 0
    sign = "+" if minutes >= 0 else "-"
    h, m = divmod(abs(minutes), 60)
    utc = f"UTC{sign}{h}" + (f":{m:02d}" if m else "")
    name = next((label for label, zone_name in POPULAR if zone_name == tz), tz)
    return f"{name} ({utc})"


def is_valid(tz: str) -> bool:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True
