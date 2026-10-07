"""Сбор: план, пул, склейка дублей, фильтр по выдаче и странице, блок hh, бюджет, отчёт."""

import html as htmlmod
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.db.models import FetchLog, Match, Profile, Search, Vacancy
from app.domain.profile_config import FilterConfig, LlmConfig, ProfileConfig, Rule, SearchConfig
from app.services import collect, profiles, users

NOW = datetime(2026, 10, 8, 6, 0, tzinfo=UTC)  # 13:00 в Бангкоке — день


def search_html(vacancies: list[dict], total: int | None = None) -> str:
    state = {"vacancySearchResult": {"totalResults": total or len(vacancies), "vacancies": vacancies}}
    return f'<template id="HH-Lux-InitialState">{htmlmod.escape(json.dumps(state))}</template>'


def vac(vid: int, name: str, company_id: int | None = 10, **kw) -> dict:
    return {"vacancyId": vid, "name": name, "company": {"id": company_id, "visibleName": f"Co{company_id}"},
            "area": {"name": kw.pop("area", "Москва")}, "workExperience": kw.pop("exp", "between1And3"), **kw}


def page_html(vid: int, description: str, archived: bool = False, skills: list[str] | None = None) -> str:
    state = {"vacancyView": {"vacancyFull": {"vacancy": {
        "vacancyId": vid, "description": f"<p>{description}</p>", "keySkills": skills or [], "status": {"archived": archived}
    }}}}
    return f'<template id="HH-Lux-InitialState">{htmlmod.escape(json.dumps(state))}</template>'


def qa_config(**search) -> ProfileConfig:
    return ProfileConfig(
        search=SearchConfig(anywhere=["QA"], in_name=["тестировщик"], roles=[124], **search),
        filter=FilterConfig(rules=[
            Rule(id="java", label="Java", stage="search", kind="reject", match=[{"fields": ["title"], "patterns": ["java"]}]),
            Rule(id="auto", label="нет автотестов", stage="page", kind="require",
                 match=[{"fields": ["description", "skills"], "patterns": ["playwright", "автотест*"]}]),
        ]),
        llm=LlmConfig(apply=["a"], maybe=["m"], skip=["s"]),
    )


async def make_profile(session, tg_id: int = 1, status: str = "active", config: ProfileConfig | None = None) -> Profile:
    user = await users.ensure_admin(session, tg_id, None, "U") if tg_id == 1 else await users.create(session, tg_id, None, "U", None)
    user.tz = "Asia/Bangkok"
    p = Profile(user_id=user.id, title="QA", status=status)
    session.add(p)
    await session.flush()
    await profiles.save_version(session, p, config or qa_config(), created_by="user")
    return p


async def run_once(session, html_text: str, status: int = 200, kind="schedule", profile_id=None, chat_id=None, now=NOW):
    run_id, tasks, why = await collect.plan(session, now, kind, profile_id, chat_id)
    assert run_id, why
    results = [await collect.ingest_search(session, run_id, t.search_id, status, html_text, None, now) for t in tasks]
    return run_id, tasks, results


async def test_pool_matches_and_search_filter(session) -> None:
    p = await make_profile(session)
    page = search_html([
        vac(1, "QA Engineer"),
        vac(2, "Java QA Automation"),
        vac(3, "QA Engineer", area="Казань"),  # та же вакансия в другом регионе — склейка
        vac(4, "Тестировщик", company_id=None),
    ], total=40)
    run_id, tasks, results = await run_once(session, page)
    assert len(tasks) == 1
    titles = {v.external_id: v for v in await session.scalars(select(Vacancy))}
    assert set(titles) == {"1", "2", "4"} and titles["1"].areas == ["Москва", "Казань"]
    matches = {m.vacancy_id: m for m in await session.scalars(select(Match).where(Match.profile_id == p.id))}
    assert matches[titles["2"].id].filter_status == "rejected" and matches[titles["2"].id].reasons == ["Java"]
    assert {pg["vacancy_id"] for pg in results[0]["pages"]} == {titles["1"].id, titles["4"].id}

    # Страница: без автотестов — отсев по правилу page; «только из РФ» — встроенная проверка
    await collect.ingest_vacancy(session, run_id, titles["1"].id, 200, page_html(1, "Ручное тестирование, работа только из РФ"), NOW)
    await collect.ingest_vacancy(session, run_id, titles["4"].id, 200, page_html(4, "Автотесты на Playwright"), NOW)
    await session.refresh(matches[titles["1"].id])
    await session.refresh(matches[titles["4"].id])
    assert matches[titles["1"].id].filter_status == "rejected"
    assert any(r.startswith("только из РФ") for r in matches[titles["1"].id].reasons)
    assert "нет автотестов" in matches[titles["1"].id].reasons
    assert matches[titles["4"].id].filter_status == "passed"

    done = await collect.finish(session, run_id, NOW)
    assert done["status"] == "ok" and done["found"] == 40 and done["new"] == 3 and done["pages"] == 2


async def test_schedule_and_second_profile_shares_search(session) -> None:
    await make_profile(session, 1)
    _, tasks, _ = await run_once(session, search_html([vac(1, "QA")]))
    # Сразу после сбора — следующий по расписанию ещё не наступил
    assert (await collect.plan(session, NOW + timedelta(minutes=1)))[0] is None
    s = await session.get(Search, tasks[0].search_id)
    assert s.next_due_at == NOW + timedelta(minutes=30)
    # Второе резюме с теми же настройками поиска — тот же поиск, но свои совпадения
    p2 = await make_profile(session, 2)
    run_id, tasks2, _ = await run_once(session, search_html([vac(1, "QA")]), now=NOW + timedelta(minutes=30))
    assert [t.search_id for t in tasks2] == [s.id]
    assert await session.scalar(select(func.count()).select_from(Match).where(Match.profile_id == p2.id)) == 1
    # Вакансия уже была в пуле со страницей «none» → страница всё ещё нужна
    assert await session.scalar(select(func.count()).select_from(Vacancy)) == 1


async def test_existing_page_applies_page_rules_immediately(session) -> None:
    await make_profile(session, 1)
    run_id, _, res = await run_once(session, search_html([vac(1, "QA")]))
    await collect.ingest_vacancy(session, run_id, res[0]["pages"][0]["vacancy_id"], 200, page_html(1, "Playwright"), NOW)
    other = await make_profile(session, 2, config=qa_config(period=3))  # другой поиск
    _, _, res2 = await run_once(session, search_html([vac(1, "QA")]), kind="trial", profile_id=other.id)
    assert res2[0]["pages"] == []  # страница уже в пуле
    m = await session.scalar(select(Match).where(Match.profile_id == other.id))
    assert m.filter_status == "passed"


async def test_block_stops_collection_and_alerts(session, no_outside_world) -> None:
    await make_profile(session)
    run_id, _, res = await run_once(session, "<html>captcha</html>")
    assert res[0]["stop"]
    assert any("капчу" in text for _, text in no_outside_world)
    run_id2, tasks, why = await collect.plan(session, NOW + timedelta(minutes=30))
    assert run_id2 is None and "паузе" in why
    # После паузы — снова пробует; успех закрывает тревогу
    later = NOW + timedelta(hours=3)
    await run_once(session, search_html([vac(1, "QA")]), now=later)
    assert any("снова работает" in text for _, text in no_outside_world)


async def test_daily_budget(session, monkeypatch) -> None:
    from app.config import get_settings

    await make_profile(session)
    monkeypatch.setattr(get_settings(), "hh_daily_cap", 2)
    session.add_all([FetchLog(kind="search", url="x", ok=True), FetchLog(kind="vacancy", url="y", ok=True)])
    await session.commit()
    run_id, _, why = await collect.plan(session, datetime.now(UTC))
    assert run_id is None and "бюджет" in why


async def test_trial_for_draft_and_report(session, no_outside_world) -> None:
    p = await make_profile(session, status="draft")
    # Черновик по расписанию не собирается
    assert (await collect.plan(session, NOW))[0] is None
    run_id, _, _ = await run_once(session, search_html([vac(1, "QA"), vac(2, "Java QA")]), kind="trial",
                                  profile_id=p.id, chat_id=555)
    await collect.finish(session, run_id, NOW)
    chat, text = no_outside_world[-1]
    assert chat == 555 and "Прошли фильтр: 1" in text and "Java 1" in text


async def test_other_users_profiles_not_touched_by_manual_run(session) -> None:
    a = await make_profile(session, 1)
    b = await make_profile(session, 2)
    await run_once(session, search_html([vac(1, "QA")]), kind="bot", profile_id=a.id, chat_id=1)
    assert await session.scalar(select(func.count()).select_from(Match).where(Match.profile_id == b.id)) == 0


async def test_preview_diff(session) -> None:
    from app.services import preview

    p = await make_profile(session)
    await run_once(session, search_html([vac(1, "QA Engineer"), vac(2, "Java QA"), vac(3, "Selenium QA")]))
    old = qa_config().filter
    new = old.model_copy(deep=True)
    new.rules[0].enabled = False  # Java больше не режем
    new.rules.append(Rule(id="selenium", label="Selenium", stage="search", kind="reject",
                          match=[{"fields": ["title"], "patterns": ["selenium"]}]))
    d = await preview.diff(session, p.id, old, new)
    assert d.total == 3
    assert d.now_passed == ["Java QA"]
    assert d.now_rejected == [("Selenium QA", ["Selenium"])]
