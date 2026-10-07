"""Карточка вакансии в Telegram (HTML) — порт v1 (n8n/shared/card.js) с оценками нескольких резюме.

Одна карточка на вакансию у пользователя: строки «🤖 …» — по одной на каждое резюме, через фильтр которого она прошла.
"""

import html
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

VERDICT = {"apply": "🟢 apply", "maybe": "🟡 maybe", "skip": "🔴 skip", "error": "⚠️ не оценено"}
# Кнопки пользователя → my_decision. earlier — «📨 Откликался раньше» (до бота): status = applied без письма,
# без «Почему?» и вне теневого режима
CHOICE = {"apply": "✅ Откликнусь", "maybe": "🤔 Возможно", "skip": "❌ Мимо", "earlier": "📨 Откликался раньше"}
STATUS_BY_CHOICE = {"apply": "approved", "maybe": "maybe", "skip": "skipped", "earlier": "applied"}
BAN_REASON = "чёрный список"
FINAL = {"expired": "⌛ Устарела: 3 дня без решения", "archived": "🔒 Вакансия закрыта на hh"}
RANK = {"apply": 3, "maybe": 2, "skip": 1}

_EXPERIENCE = {"noExperience": "без опыта", "between1And3": "1–3 г.", "between3And6": "3–6 л.", "moreThan6": "6+ л."}
_CURRENCY = {"RUR": "₽", "USD": "$", "EUR": "€", "KZT": "₸", "BYR": "Br", "UZS": "сум"}


@dataclass
class Line:
    """Оценка одного резюме."""

    profile_id: int
    label: str  # «🧪 QA»
    decision: str | None
    reason: str | None


def esc(s: Any) -> str:
    return html.escape(str(s or ""), quote=False)


def _short(n: int) -> str:
    return f"{round(n / 1000)}k" if n >= 1000 else str(n)


def salary(v: Any) -> str:
    if not v.salary_from and not v.salary_to:
        return ""
    if v.salary_from and v.salary_to:
        rng = f"{_short(v.salary_from)}–{_short(v.salary_to)}"
    elif v.salary_from:
        rng = f"от {_short(v.salary_from)}"
    else:
        rng = f"до {_short(v.salary_to)}"
    return f"💰 {rng} {_CURRENCY.get(v.currency or '', v.currency or '')}{' до налогов' if v.salary_gross else ''}".strip()


def areas(items: list[str]) -> str:
    # «Москва, Сербия, Грузия, Армения» → «Москва, Сербия +2»
    return ", ".join(items[:2]) + (f" +{len(items) - 2}" if len(items) > 2 else "")


def best(lines: list[Line]) -> str | None:
    """Самая высокая оценка среди резюме (ошибки не считаются)."""
    known = [x.decision for x in lines if x.decision in RANK]
    return max(known, key=RANK.__getitem__) if known else None


def text(
    v: Any,
    lines: list[Line],
    tz: str,
    status: str = "waiting",
    my_decision: str | None = None,
    my_reason: str | None = None,
    chosen: str | None = None,
    applied_at: datetime | None = None,
) -> str:
    zone = ZoneInfo(tz)
    published = v.published_at.astimezone(zone).strftime("%d.%m") if v.published_at else ""
    meta = " · ".join(
        x for x in [esc(v.company), salary(v), _EXPERIENCE.get(v.experience or "", ""), esc(areas(v.areas or [])),
                    published and f"📅 {published}"] if x
    )
    flags = " · ".join(
        x for x in [
            v.has_test and "📝 тест",
            v.letter_required and "✉️ письмо обязательно",
            v.responses is not None and f"👥 {v.responses}",
            v.page_status == "error" and "⚠️ страница не открылась — оценка по фрагменту",
        ] if x
    )
    verdicts = [
        f"🤖 {esc(x.label)}: {VERDICT.get(x.decision or '', esc(x.decision))}" + (f" — {esc(x.reason)}" if x.reason else "")
        for x in lines
    ]
    mine = ""
    if my_decision in CHOICE:
        mine = f"👤 {CHOICE[my_decision]}"
        if chosen:
            mine += f" · {esc(chosen)}"
        if my_reason == BAN_REASON:
            mine += " · 🚫 компания в чёрном списке"
    sent = ""
    if status == "applied" and my_decision != "earlier":
        sent = "📨 Отклик отправлен" + (f" {applied_at.astimezone(zone):%d.%m}" if applied_at else "")
    parts = [f'<a href="{esc(v.url)}"><b>{esc(v.title)}</b></a>', meta, flags, *verdicts, mine, sent, FINAL.get(status, "")]
    return "\n".join(p for p in parts if p)[:4000]


def is_quiet_hour(tz: str, now: datetime) -> bool:
    """Тихие часы владельца: с 23:00 до 09:00 карточки без звука."""
    hour = now.astimezone(ZoneInfo(tz)).hour
    return hour >= 23 or hour < 9
