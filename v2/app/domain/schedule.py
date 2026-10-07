"""Расписание сбора резюме — порт n8n/shared/schedule.js, но по часовому поясу пользователя (в v1 — МСК).

Днём [from, to) — каждые day_every мин, ночью — каждые night_every мин (0 — ночью не собирать).
Слоты выровнены по местной полуночи, шаг сетки — 15 мин.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.domain.profile_config import ScheduleConfig

STEP = timedelta(minutes=15)


def window(cfg: ScheduleConfig) -> tuple[int, int]:
    start, end = cfg.day_window.split("-")
    return int(start), int(end)


def is_slot(t: datetime, cfg: ScheduleConfig, tz: str) -> bool:
    if cfg.paused:
        return False
    local = t.astimezone(ZoneInfo(tz))
    start, end = window(cfg)
    every = cfg.day_every if start <= local.hour < end else cfg.night_every
    return every > 0 and (local.hour * 60 + local.minute) % every == 0


def next_slot(t: datetime, cfg: ScheduleConfig, tz: str) -> datetime | None:
    """Ближайший сбор строго после t; None — на паузе или расписание пустое."""
    if cfg.paused:
        return None
    epoch = datetime(2000, 1, 1, tzinfo=t.tzinfo)
    s = epoch + ((t - epoch) // STEP + 1) * STEP
    for _ in range(2 * 96):
        if is_slot(s, cfg, tz):
            return s
        s += STEP
    return None


def per_day(cfg: ScheduleConfig) -> int:
    start, end = window(cfg)
    day = sum(1 for m in range(start * 60, end * 60, 15) if cfg.day_every and m % cfg.day_every == 0)
    night_minutes = [m for m in range(0, 24 * 60, 15) if not start * 60 <= m < end * 60]
    night = sum(1 for m in night_minutes if cfg.night_every and m % cfg.night_every == 0)
    return day + night
