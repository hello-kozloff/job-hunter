"""Карточка резюме и экраны настроек в боте."""

import html

from aiogram.types import InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from app.bot.callbacks import Prof
from app.bot.texts import t
from app.db.models import Profile
from app.domain.hh.roles import IT_ROLES, WORK_FORMATS
from app.services.profiles import Loaded

# Кнопки под полем ввода
MENU = ReplyKeyboardMarkup(keyboard=[[KeyboardButton(text=t("menu.resumes"))]], resize_keyboard=True, is_persistent=True)


def _list(items: list[str], limit: int = 12) -> str:
    if not items:
        return t("profile.none")
    shown = ", ".join(html.escape(i) for i in items[:limit])
    return shown + (f" … +{len(items) - limit}" if len(items) > limit else "")


def _bullets(items: list[str]) -> str:
    return "; ".join(html.escape(i) for i in items) or t("profile.none")


def card_text(loaded: Loaded) -> str:
    p, c = loaded.profile, loaded.config
    rules = "\n".join(f"{'✅' if r.enabled else '⬜'} {html.escape(r.label)}" for r in c.filter.rules) or t("profile.no_rules")
    cases = "".join(f"\n• {html.escape(x.case)} → {x.decision}" for x in c.llm.cases)
    text = t(
        "profile.card",
        emoji=p.emoji,
        title=html.escape(p.title),
        status=t(f"status.{p.status}"),
        version=loaded.version,
        headline=html.escape(loaded.headline),
        period=t("profile.days", n=c.search.period),
        formats=", ".join(WORK_FORMATS.get(f, f) for f in c.search.work_format),
        roles=_list([IT_ROLES.get(r, str(r)) for r in c.search.roles]),
        anywhere=_list(c.search.anywhere),
        in_name=_list(c.search.in_name),
        max_responses=c.filter.max_responses or "∞",
        only_rf=t("profile.only_rf") if c.filter.only_rf else "",
        rules=rules,
        shadow=t("profile.shadow_on") if p.shadow else "",
        apply=_bullets(c.llm.apply),
        maybe=_bullets(c.llm.maybe),
        skip=_bullets(c.llm.skip),
        cases=cases,
        contact=html.escape(c.letter.contact) or t("profile.none"),
    )
    return text[:4000]


def card_keyboard(p: Profile) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text=t("profile.btn_edit"), callback_data=Prof(action="edit", pid=p.id))
    kb.button(text=t("profile.btn_rules"), callback_data=Prof(action="rules", pid=p.id))
    if p.status == "active":
        kb.button(text=t("profile.btn_pause"), callback_data=Prof(action="pause", pid=p.id))
    else:
        kb.button(text=t("profile.btn_start"), callback_data=Prof(action="start", pid=p.id))
    kb.button(
        text=t("profile.btn_shadow_on" if p.shadow else "profile.btn_shadow_off"), callback_data=Prof(action="shadow", pid=p.id)
    )
    kb.button(text=t("profile.btn_delete"), callback_data=Prof(action="del", pid=p.id))
    kb.button(text=t("profile.btn_list"), callback_data=Prof(action="list"))
    kb.adjust(1, 2, 2, 1)
    return kb.as_markup()


def rules_keyboard(loaded: Loaded) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for r in loaded.config.filter.rules:
        kb.button(
            text=f"{'✅' if r.enabled else '⬜'} {r.label}"[:60], callback_data=Prof(action="rule", pid=loaded.profile.id, arg=r.id[:24])
        )
    kb.button(text=t("profile.btn_back"), callback_data=Prof(action="open", pid=loaded.profile.id))
    kb.adjust(1)
    return kb.as_markup()


def list_view(profiles: list[Profile]) -> tuple[str, InlineKeyboardMarkup]:
    kb = InlineKeyboardBuilder()
    for p in profiles:
        kb.button(text=f"{p.emoji} {p.title} · {t(f'status.{p.status}')}", callback_data=Prof(action="open", pid=p.id))
    kb.button(text=t("profiles.add"), callback_data=Prof(action="add"))
    kb.adjust(1)
    return (t("profiles.title") if profiles else t("profiles.empty")), kb.as_markup()
