"""Сбор вакансий: план для n8n, приём страниц hh, общий пул, совпадения по резюме и фильтр.

Шаги (их вызывает n8n v2 «V2 Collect», он же ходит на hh):
1. plan — какие поиски пора выполнить (расписание резюме, бюджет запросов, стоп после капчи) → run + задачи;
2. ingest_search — страница выдачи: детектор блока, пул (склейка дублей), совпадения + фильтр по выдаче
   для каждого резюме этого поиска → какие страницы вакансий нужны;
3. ingest_vacancy — страница вакансии: описание в пул, фильтр по странице для ждущих совпадений;
4. finish — итог сбора; для «пробного» и «собрать сейчас» — отчёт пользователю.
"""

import html
import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import Integer, Text, cast, delete, func, select, update
from sqlalchemy.dialects.postgresql import ARRAY, array as pg_array, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.texts import t
from app.config import get_settings
from app.db.models import (
    Blacklist,
    FetchLog,
    Match,
    Profile,
    ProfileConfig as ConfigRow,
    ProfileSearch,
    Run,
    Search,
    SystemState,
    User,
    Vacancy,
)
from app.domain import schedule
from app.domain.filter import builtin, engine
from app.domain.hh import parse, search as hh_search
from app.domain.hh.roles import ROLES, WORK_FORMATS
from app.domain.profile_config import ProfileConfig
from app.services import alerts, notify

log = logging.getLogger(__name__)

STOP_KEY = "collect.stop"
STALE_RUN = timedelta(minutes=30)
MANUAL_KINDS = ("bot", "trial")
MSK = ZoneInfo("Europe/Moscow")


# ---------- Резюме, участвующие в сборе ----------


@dataclass
class Ctx:
    """Резюме глазами сбора: настройки, часовой пояс владельца, чёрный список."""

    profile: Profile
    user: User
    config: ProfileConfig
    config_id: int
    bl_names: set[str] = field(default_factory=set)
    bl_ids: set[str] = field(default_factory=set)


async def _contexts(session: AsyncSession, profile_ids: list[int] | None = None, manual: bool = False) -> list[Ctx]:
    """Резюме для сбора: по расписанию — активные у активных пользователей; вручную — указанные (и черновики)."""
    stmt = select(Profile, User, ConfigRow).join(User, User.id == Profile.user_id).join(
        ConfigRow, ConfigRow.id == Profile.active_config_id
    ).where(User.status == "active")
    if profile_ids is not None:
        stmt = stmt.where(Profile.id.in_(profile_ids))
    if not manual:
        stmt = stmt.where(Profile.status == "active")
    out = []
    for profile, user, row in (await session.execute(stmt)).all():
        cfg = ProfileConfig.model_validate(row.config)
        if not manual and cfg.schedule.paused:
            continue
        out.append(Ctx(profile, user, cfg, row.id))
    if out:
        rows = await session.execute(
            select(Blacklist.profile_id, Blacklist.company, Blacklist.company_id).where(
                Blacklist.profile_id.in_([c.profile.id for c in out])
            )
        )
        by_id = {c.profile.id: c for c in out}
        for pid, company, company_id in rows.all():
            if company:
                by_id[pid].bl_names.add(builtin.norm_company(company))
            if company_id:
                by_id[pid].bl_ids.add(company_id)
    return out


async def _link_search(session: AsyncSession, ctx: Ctx) -> Search:
    """Поиск резюме по его текущим настройкам: тот же URL у разных резюме — одна строка searches."""
    u = hh_search.url(ctx.config.search)
    h = hh_search.url_hash(u)
    await session.execute(insert(Search).values(url_hash=h, url=u).on_conflict_do_nothing(index_elements=[Search.url_hash]))
    s = await session.scalar(select(Search).where(Search.url_hash == h))
    # У резюме ровно один поиск: настройки поменялись — старая связь заменяется
    await session.execute(delete(ProfileSearch).where(ProfileSearch.profile_id == ctx.profile.id, ProfileSearch.search_id != s.id))
    await session.execute(
        insert(ProfileSearch).values(profile_id=ctx.profile.id, search_id=s.id).on_conflict_do_nothing()
    )
    return s


# ---------- Бюджет и стоп ----------


async def _stopped_until(session: AsyncSession, now: datetime) -> datetime | None:
    state = await session.get(SystemState, STOP_KEY)
    if state and state.value.get("until"):
        until = datetime.fromisoformat(state.value["until"])
        if until > now:
            return until
    return None


async def fetches_last_day(session: AsyncSession, now: datetime) -> int:
    return await session.scalar(
        select(func.count()).select_from(FetchLog).where(
            FetchLog.created_at > now - timedelta(days=1), FetchLog.kind.in_(("search", "vacancy", "recheck"))
        )
    ) or 0


async def _set_stop(session: AsyncSession, now: datetime, reason: str) -> datetime:
    until = now + timedelta(minutes=get_settings().hh_block_pause_minutes)
    value = {"until": until.isoformat(), "reason": reason, "since": now.isoformat()}
    await session.execute(
        insert(SystemState).values(name=STOP_KEY, value=value).on_conflict_do_update(
            index_elements=[SystemState.name], set_={"value": value}
        )
    )
    return until


async def _clear_stop(session: AsyncSession) -> None:
    await session.execute(delete(SystemState).where(SystemState.name == STOP_KEY))


async def _bump(session: AsyncSession, run_id: int, **deltas: int) -> None:
    """Счётчики сбора += delta одним UPDATE: n8n шлёт страницы параллельно, чтение-правка-запись теряла бы шаги."""
    expr = Run.stats
    for key, delta in deltas.items():
        expr = expr.op("||")(
            func.jsonb_build_object(key, func.coalesce(Run.stats[key].astext.cast(Integer), 0) + delta)
        )
    # synchronize_session=False: иначе ORM «протухнет» объект Run в сессии (следующее чтение полей → MissingGreenlet)
    await session.execute(
        update(Run).where(Run.id == run_id).values(stats=expr).execution_options(synchronize_session=False)
    )


async def _note_search(session: AsyncSession, run_id: int, search_id: int, **info: object) -> None:
    """Итог запроса поиска для отчёта (stats.by_search.<id>) — тоже одним UPDATE, как _bump."""
    path = cast(pg_array(["by_search", str(search_id)]), ARRAY(Text))
    value = func.jsonb_build_object(*[x for kv in info.items() for x in kv])
    await session.execute(
        update(Run).where(Run.id == run_id).values(stats=func.jsonb_set(Run.stats, path, value, True))
        .execution_options(synchronize_session=False)
    )


# ---------- 1. План ----------


@dataclass
class Task:
    search_id: int
    url: str


async def plan(
    session: AsyncSession, now: datetime, kind: str = "schedule", profile_id: int | None = None, chat_id: int | None = None
) -> tuple[int | None, list[Task], str | None]:
    """(run_id, задачи, причина пустого плана). Задач нет — run не создаётся."""
    # Зависшие сборы (n8n упал посреди) закрываем
    await session.execute(
        update(Run).where(Run.status == "running", Run.started_at < now - STALE_RUN).values(
            status="error", error="не завершён за 30 мин", finished_at=now
        )
    )
    until = await _stopped_until(session, now)
    if until:
        await session.commit()
        return None, [], f"сбор на паузе после блока hh до {until:%H:%M} UTC"
    if await fetches_last_day(session, now) >= get_settings().hh_daily_cap:
        await session.commit()
        return None, [], "исчерпан суточный бюджет запросов к hh"

    manual = kind in MANUAL_KINDS
    ctxs = await _contexts(session, [profile_id] if profile_id else None, manual=manual)
    searches: dict[int, Search] = {}
    profile_search: dict[int, int] = {}
    for ctx in ctxs:
        s = await _link_search(session, ctx)
        searches[s.id] = s
        profile_search[ctx.profile.id] = s.id
    due = [s for s in searches.values() if manual or s.next_due_at is None or s.next_due_at <= now]
    if not due:
        await session.commit()
        return None, [], "по расписанию собирать пока нечего" if not manual else "у резюме нет настроек поиска"
    stats = {"searches": len(due), "found": 0, "new": 0, "pages": 0, "page_errors": 0, "by_search": {}}
    if not manual:
        # Кому после сбора по расписанию уйдёт отчёт: резюме, чей поиск выполняется
        due_ids = {s.id for s in due}
        stats["profiles"] = [c.profile.id for c in ctxs if c.profile.id in profile_search and profile_search[c.profile.id] in due_ids]
    if profile_id:
        stats["profile_id"] = profile_id
    if chat_id:
        stats["chat_id"] = chat_id
    run = Run(kind=kind, stats=stats)
    session.add(run)
    await session.commit()
    return run.id, [Task(s.id, s.url) for s in due], None


# ---------- 2. Выдача ----------


async def _schedule_next(session: AsyncSession, search: Search, now: datetime) -> None:
    ctxs = await _contexts(
        session,
        list(await session.scalars(select(ProfileSearch.profile_id).where(ProfileSearch.search_id == search.id))),
    )
    slots = [x for c in ctxs if (x := schedule.next_slot(now, c.config.schedule, c.user.tz))]
    search.last_run_at = now
    search.next_due_at = min(slots) if slots else None


def _search_reasons(ctx: Ctx, v: Vacancy) -> list[str]:
    view = {"title": v.title, "skills": v.key_skills, "snippet": v.snippet or "", "experience": v.experience or "",
            "company": v.company or ""}
    reasons = engine.reasons(ctx.config.filter.rules, view, "search")
    limit = ctx.config.filter.max_responses
    if limit and (v.responses or 0) > limit:
        reasons.append(f"> {limit} откликов")
    if builtin.in_blacklist(v.company, v.company_id, ctx.bl_names, ctx.bl_ids):
        reasons.append("чёрный список")
    return reasons


def _page_reasons(ctx: Ctx, v: Vacancy) -> list[str]:
    reasons = []
    if v.archived_at:
        reasons.append("в архиве")
    if ctx.config.filter.only_rf and (hit := builtin.only_rf(v.description or "")):
        reasons.append(f"только из РФ: «{hit}»")
    view = {"title": v.title, "skills": v.key_skills, "snippet": v.snippet or "", "description": v.description or "",
            "experience": v.experience or "", "company": v.company or ""}
    reasons += engine.reasons(ctx.config.filter.rules, view, "page")
    return reasons


async def _upsert_pool(session: AsyncSession, records: list[parse.Record]) -> tuple[list[Vacancy], int]:
    """Вакансии выдачи в пуле (новые вставляются) и сколько новых. Дубль по dup_key другой вакансии — пропуск."""
    ids = [r.external_id for r in records]
    existing = {
        v.external_id: v
        for v in await session.scalars(select(Vacancy).where(Vacancy.source == "hh", Vacancy.external_id.in_(ids)))
    }
    keys = {r.dup_key for r in records if r.external_id not in existing}
    taken = set(await session.scalars(select(Vacancy.dup_key).where(Vacancy.dup_key.in_(keys)))) if keys else set()
    out, new = [], 0
    for r in records:
        if r.external_id in existing:
            v = existing[r.external_id]
            v.responses = r.responses
            v.areas = list(dict.fromkeys([*v.areas, *r.areas]))
            out.append(v)
            continue
        if r.dup_key in taken:
            continue  # та же вакансия в другом регионе уже в пуле
        v = Vacancy(**{k: getattr(r, k) for k in r.__dataclass_fields__})
        session.add(v)
        out.append(v)
        taken.add(r.dup_key)
        new += 1
    await session.flush()
    return out, new


async def ingest_search(
    session: AsyncSession, run_id: int, search_id: int, status: int, text: str, location: str | None, now: datetime
) -> dict:
    """Страница выдачи → пул и совпадения. Ответ для n8n: {pages: [{vacancy_id, url}], stop}."""
    search = await session.get(Search, search_id)
    run = await session.get(Run, run_id)
    if search is None or run is None:
        return {"pages": [], "stop": False}
    page = parse.parse_search(status, text, location)
    session.add(FetchLog(kind="search", url=search.url, http_status=status, ok=page.ok, bytes=len(text),
                         error=None if page.ok else page.reason))
    await _note_search(session, run_id, search_id, status=status, total=page.total if page.ok else None,
                       count=page.count if page.ok else 0, uniq=len(page.records) if page.ok else 0)
    if not page.ok:
        until = await _set_stop(session, now, page.reason)
        run.status, run.error, run.finished_at = "error", page.reason, now
        await session.commit()
        await alerts.raise_alert(
            session, "v2 сбор: hh", f"{page.reason}\nСбор остановлен до {until:%H:%M} UTC, потом попробует снова.", now
        )
        return {"pages": [], "stop": True}
    await _clear_stop(session)

    vacancies, new = await _upsert_pool(session, page.records)
    await _bump(session, run_id, found=page.total or 0, new=new)
    stats = run.stats

    profile_ids = list(await session.scalars(select(ProfileSearch.profile_id).where(ProfileSearch.search_id == search_id)))
    if run.kind in MANUAL_KINDS and stats.get("profile_id"):
        profile_ids = [p for p in profile_ids if p == stats["profile_id"]] or [stats["profile_id"]]
    ctxs = await _contexts(session, profile_ids, manual=run.kind in MANUAL_KINDS)
    known = set(
        (await session.execute(
            select(Match.profile_id, Match.vacancy_id).where(
                Match.profile_id.in_(profile_ids), Match.vacancy_id.in_([v.id for v in vacancies])
            )
        )).all()
    )
    need_page: dict[int, Vacancy] = {}
    for ctx in ctxs:
        for v in vacancies:
            if (ctx.profile.id, v.id) in known:
                continue
            reasons = _search_reasons(ctx, v)
            status_ = "rejected" if reasons else "search_passed"
            if not reasons and v.page_status != "none":
                reasons = [] if v.page_status == "error" else _page_reasons(ctx, v)
                status_ = "rejected" if reasons else "passed"
            session.add(Match(profile_id=ctx.profile.id, vacancy_id=v.id, filter_status=status_, reasons=reasons,
                              config_id=ctx.config_id, run_id=run_id))
            if status_ == "search_passed":
                need_page[v.id] = v
    await _schedule_next(session, search, now)
    await session.commit()
    await alerts.resolve(session, "v2 сбор: hh")
    return {"pages": [{"vacancy_id": v.id, "url": v.url} for v in need_page.values()], "stop": False}


# ---------- 3. Страница вакансии ----------


async def ingest_vacancy(session: AsyncSession, run_id: int, vacancy_id: int, status: int, text: str, now: datetime) -> dict:
    v = await session.get(Vacancy, vacancy_id)
    run = await session.get(Run, run_id)
    if v is None:
        return {"ok": False}
    page = parse.parse_vacancy(status, text)
    if page.error is None and page.vacancy_id != v.external_id:
        page = parse.VacancyPage(error=f"страница: пришла вакансия {page.vacancy_id}")
    session.add(FetchLog(kind="vacancy", url=v.url, http_status=status, ok=page.error is None, bytes=len(text), error=page.error))
    v.page_fetched_at = now
    if page.error:
        # Вакансию не теряем: нейросеть оценит её по фрагменту из выдачи, ошибка видна в карточке
        v.page_status, v.page_error = "error", page.error
    else:
        v.page_status, v.page_error = "ok", None
        v.description = page.description
        v.key_skills = page.key_skills or v.key_skills
        v.contract = page.contract or v.contract
        if page.has_test is not None:
            v.has_test = page.has_test
        if page.archived and not v.archived_at:
            v.archived_at = now
    if run:
        await _bump(session, run_id, pages=1, page_errors=1 if page.error else 0)

    waiting = list(await session.scalars(select(Match).where(Match.vacancy_id == v.id, Match.filter_status == "search_passed")))
    if waiting:
        ctxs = {c.profile.id: c for c in await _contexts(session, [m.profile_id for m in waiting], manual=True)}
        for m in waiting:
            ctx = ctxs.get(m.profile_id)
            reasons = [] if page.error or ctx is None else _page_reasons(ctx, v)
            m.filter_status = "rejected" if reasons else "passed"
            m.reasons = reasons
    await session.commit()
    return {"ok": page.error is None}


# ---------- 4. Итог ----------


async def finish(session: AsyncSession, run_id: int, now: datetime) -> dict:
    run = await session.get(Run, run_id, populate_existing=True)
    if run is None:
        return {}
    if run.status == "running":
        run.status = "ok"
    run.finished_at = now
    await session.commit()
    pid, chat = run.stats.get("profile_id"), run.stats.get("chat_id")
    if run.kind in MANUAL_KINDS and pid and chat:
        await notify.send(chat, await report(session, run, pid))
    elif run.kind not in MANUAL_KINDS and run.stats.get("profiles"):
        await send_schedule_reports(session, run, now)
    return {"status": run.status, **run.stats}


async def report(session: AsyncSession, run: Run, profile_id: int) -> str:
    """Отчёт сбора по резюме: сколько нашёл hh, что прошло фильтр и почему отсеяно остальное."""
    rows = (
        await session.execute(
            select(Match, Vacancy).join(Vacancy, Vacancy.id == Match.vacancy_id).where(
                Match.run_id == run.id, Match.profile_id == profile_id
            )
        )
    ).all()
    if run.status == "error":
        return f"😕 Сбор не удался: {html.escape(run.error or 'ошибка')}"
    passed = [v for m, v in rows if m.filter_status in ("passed", "search_passed")]
    rejected = [(m, v) for m, v in rows if m.filter_status == "rejected"]
    why = Counter(r.split(":")[0] for m, _ in rejected for r in m.reasons)
    lines = [
        f"🔎 <b>Сбор</b>: hh нашёл {run.stats.get('found', 0)}, новых для резюме {len(rows)}",
        f"✅ Прошли фильтр: {len(passed)}",
        f"🧹 Отсеяно: {len(rejected)}" + (" — " + ", ".join(f"{html.escape(k)} {n}" for k, n in why.most_common(6)) if why else ""),
    ]
    if passed:
        lines.append("\n<b>Прошли</b>")
        lines += [f'• <a href="{v.url}">{html.escape(v.title)}</a> — {html.escape(v.company or "")}' for v in passed[:10]]
    if rejected:
        lines.append("\n<b>Отсеяны</b>")
        lines += [
            f'• <a href="{v.url}">{html.escape(v.title)}</a> — {html.escape(", ".join(m.reasons))}' for m, v in rejected[:8]
        ]
    if run.stats.get("page_errors"):
        lines.append(f"\n⚠️ Не открылось страниц: {run.stats['page_errors']} (оценятся по фрагменту)")
    if not rows and run.stats.get("found", 0) == 0:
        lines.append("\nЗа период поиска вакансий нет. Можно расширить поиск: «✏️ Изменить текстом».")
    return "\n".join(lines)[:4000]


# ---------- Отчёт о сборе по расписанию ----------

REPORT_REJECTED = 5


def _plural(n: int, one: str, few: str, many: str) -> str:
    d, dd = n % 10, n % 100
    if d == 1 and dd != 11:
        return one
    return few if 2 <= d <= 4 and not 12 <= dd <= 14 else many


def _clock(moment: datetime, tz: str) -> str:
    """«15:30» по поясу пользователя, при поясе не МСК — «15:30 (11:30 МСК)»: hh и вакансии живут по Москве."""
    local, msk = moment.astimezone(ZoneInfo(tz)), moment.astimezone(MSK)
    if local.utcoffset() == msk.utcoffset():
        return f"{local:%H:%M}"
    return t("collect.clock_msk", local=f"{local:%H:%M}", msk=f"{msk:%H:%M}")


def _search_words(cfg: ProfileConfig) -> str:
    c = cfg.search
    lines = []
    if c.anywhere:
        lines.append(t("collect.words_anywhere", words=", ".join(c.anywhere)))
    if c.in_name:
        lines.append(t("collect.words_name", words=", ".join(c.in_name)))
    filters = [
        t("collect.filter_period", n=c.period),
        ", ".join(WORK_FORMATS.get(f, f) for f in c.work_format),
        ", ".join(ROLES.get(r, str(r)) for r in c.roles),
    ]
    if c.education_not_required:
        filters.append(t("collect.filter_education"))
    lines.append(" · ".join(x for x in filters if x))
    return html.escape("\n".join(lines))


def _profile_block(ctx: Ctx, run: Run, search: Search | None, rows: list[tuple[Match, Vacancy]], now: datetime,
                   several: bool) -> tuple[str, int]:
    """Блок резюме в отчёте и число новых для него."""
    info = (run.stats.get("by_search") or {}).get(str(search.id)) if search else None
    passed = [v for m, v in rows if m.filter_status in ("passed", "search_passed")]
    rejected = [(m, v) for m, v in rows if m.filter_status == "rejected"]
    # Страницы вакансий, которые этот сбор открыл ради резюме (остальные уже были в общем пуле)
    opened = [v for _, v in rows if v.page_fetched_at and v.page_fetched_at >= run.started_at]
    broken = sum(1 for v in opened if v.page_status == "error")

    lines = [t("collect.sched_profile", emoji=ctx.profile.emoji, title=html.escape(ctx.profile.title))] if several else []
    if info is None:
        lines.append(t("collect.sched_no_search"))
    else:
        sent = 1 + len(opened)
        line = t("collect.sched_requests", n=sent, word=_plural(sent, "запрос", "запроса", "запросов"),
                 status=info.get("status"))
        if opened:
            line += t("collect.sched_pages", n=len(opened))
            if broken:
                line += t("collect.sched_pages_broken", n=broken)
        lines.append(line)
        if info.get("total") is not None:
            if not rows:
                result = t("collect.sched_all_known")
            elif not rejected:
                result = t("collect.sched_all_passed", n=len(rows))
            elif not passed:
                result = t("collect.sched_all_rejected", n=len(rows))
            else:
                result = t("collect.sched_mixed", n=len(rows), passed=len(passed), rejected=len(rejected))
            parts = [t("collect.sched_found", period=t("collect.filter_period", n=ctx.config.search.period),
                       total=info["total"])]
            if (info.get("count") or 0) < info["total"]:
                parts.append(t("collect.sched_on_page", n=info.get("count") or 0))
            parts.append(t("collect.sched_uniq", n=info.get("uniq") or 0, result=result))
            lines.append(", ".join(parts))
    for m, v in rejected[:REPORT_REJECTED]:
        reasons = ", ".join(m.reasons)
        reasons = reasons if len(reasons) <= 120 else reasons[:119] + "…"
        lines.append(t("collect.sched_rejected", url=html.escape(v.url), title=html.escape(v.title),
                       reasons=html.escape(reasons)))
    if len(rejected) > REPORT_REJECTED:
        lines.append(t("collect.sched_more", n=len(rejected) - REPORT_REJECTED))
    lines.append(t("collect.sched_query", query=_search_words(ctx.config)))
    if search:
        lines.append(t("collect.sched_link", url=html.escape(search.url)))
    nxt = schedule.next_slot(now, ctx.config.schedule, ctx.user.tz)
    lines.append(t("collect.sched_next", at=_clock(nxt, ctx.user.tz)) if nxt else t("collect.sched_paused"))
    return "\n".join(lines), len(rows)


async def send_schedule_reports(session: AsyncSession, run: Run, now: datetime) -> int:
    """Сбор по расписанию → каждому пользователю отдельное сообщение без звука: блок «🔎 Сбор» как в v1
    (запросы к hh, что нашёл поиск, новые и отсеянные с причинами, запрос, следующий сбор) по каждому его резюме.
    Иначе при «новых нет» пользователь не видит, что сбор вообще идёт. Возвращает, скольким отправлено."""
    ctxs = await _contexts(session, list(run.stats["profiles"]), manual=True)
    if not ctxs:
        return 0
    links = dict(
        (await session.execute(select(ProfileSearch.profile_id, ProfileSearch.search_id).where(
            ProfileSearch.profile_id.in_([c.profile.id for c in ctxs])
        ))).all()
    )
    searches = {s.id: s for s in await session.scalars(select(Search).where(Search.id.in_(set(links.values()))))}
    rows = (
        await session.execute(
            select(Match, Vacancy).join(Vacancy, Vacancy.id == Match.vacancy_id).where(Match.run_id == run.id)
            .order_by(Match.id)
        )
    ).all()
    by_profile: dict[int, list[tuple[Match, Vacancy]]] = {}
    for m, v in rows:
        by_profile.setdefault(m.profile_id, []).append((m, v))

    by_user: dict[int, list[Ctx]] = {}
    for ctx in ctxs:
        by_user.setdefault(ctx.user.id, []).append(ctx)
    sent = 0
    for user_ctxs in by_user.values():
        user = user_ctxs[0].user
        several = len(user_ctxs) > 1
        blocks, new = [], 0
        for ctx in sorted(user_ctxs, key=lambda c: c.profile.id):
            block, n = _profile_block(ctx, run, searches.get(links.get(ctx.profile.id)), by_profile.get(ctx.profile.id, []),
                                      now, several)
            blocks.append(block)
            new += n
        if run.status == "error":
            head = t("collect.sched_failed", at=_clock(run.started_at, user.tz), error=html.escape(run.error or ""))
        else:
            head = t("collect.sched_head", at=_clock(run.started_at, user.tz),
                     new=t("collect.sched_new", n=new) if new else t("collect.sched_no_new"))
        text = "\n\n".join([head, *blocks]) if several else head + "\n" + blocks[0]
        if await notify.send(user.tg_id, text[:4000], disable_notification=True):
            sent += 1
    return sent


# ---------- Запуск из бота ----------


async def trigger(profile_id: int, chat_id: int, kind: str) -> bool:
    """«🧪 Пробный сбор» / «🔄 Собрать сейчас»: webhook n8n v2 запускает тот же сбор только для этого резюме."""
    import httpx

    s = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                s.n8n_collect_webhook,
                json={"kind": kind, "profile_id": profile_id, "chat_id": chat_id},
                headers={"X-Internal-Token": s.internal_token},
            )
        return r.status_code == 200
    except httpx.HTTPError as e:
        log.warning("collect webhook failed: %s", e)
        return False
