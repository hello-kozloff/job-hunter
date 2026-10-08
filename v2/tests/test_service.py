"""Сервис: список и статистика, утренняя сводка по поясу, устаревшие, закрытые на hh, чистка, здоровье в /admin."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.bot.routers.menu import list_view, stats_text
from app.db.models import Run, UserVacancy, Vacancy
from app.services import admin, cards, daily, menu, score
from tests.test_collect import page_html
from tests.test_score import fake_llm, make_profile, make_user, make_vacancy, passed


async def setup_cards(session, monkeypatch, tg_id: int, n: int = 3):
    user = await make_user(session, tg_id)
    qa = await make_profile(session, user, "QA")
    for i in range(n):
        await passed(session, qa, await make_vacancy(session, tg_id * 100 + i))
    fake_llm(monkeypatch, {"QA": "apply"})
    await score.run(session, budget=10, pause=0)
    rows = list(await session.scalars(select(UserVacancy).where(UserVacancy.user_id == user.id).order_by(UserVacancy.id)))
    return user, qa, rows


async def test_list_tabs_and_isolation(session, monkeypatch) -> None:
    user, qa, rows = await setup_cards(session, monkeypatch, 701)
    other, _, _ = await setup_cards(session, monkeypatch, 702, n=1)
    await cards.press(session, user, rows[0].id, "skip")

    new, total = await menu.page(session, user.id, "new", 0)
    assert total == 2 and all(uv.user_id == user.id for uv, _ in new)
    skipped, total = await menu.page(session, user.id, "skip", 0)
    assert total == 1 and skipped[0][0].id == rows[0].id
    assert (await menu.page(session, other.id, "all", 0))[1] == 1

    text, kb = await list_view(session, user, "new", 0)
    assert "🆕 Новые · 2" in text and len(kb.inline_keyboard) == 1 + 2  # вкладки + 2 вакансии

    # Статистика: решения нейросети и совпадение с решениями пользователя
    st = (await menu.profile_stats(session, user.id))[0]
    assert st.passed == 3 and st.decisions["apply"] == 3 and (st.agree, st.compared) == (0, 1)
    assert "совпадение с тобой: 0 из 1" in await stats_text(session, user)


async def test_resend_card_becomes_main(session, monkeypatch, no_outside_world) -> None:
    user, qa, rows = await setup_cards(session, monkeypatch, 703, n=1)
    old = rows[0].tg_card_id
    assert await cards.resend(session, user, rows[0]) and rows[0].tg_card_id != old


async def test_expire_after_three_days(session, monkeypatch, no_outside_world) -> None:
    user, qa, rows = await setup_cards(session, monkeypatch, 704, n=2)
    rows[0].card_at = datetime.now(UTC) - timedelta(days=4)
    await session.commit()
    assert await daily.expire(session, datetime.now(UTC)) == 1
    assert rows[0].status == "expired" and rows[1].status == "waiting"
    assert "⌛ Устарела" in no_outside_world[-1][1]


async def test_recheck_archived_and_block(session, monkeypatch, no_outside_world) -> None:
    user, qa, rows = await setup_cards(session, monkeypatch, 705, n=2)
    now = datetime.now(UTC) + timedelta(days=2)
    plan = await daily.recheck_plan(session, now)
    assert {p["vacancy_id"] for p in plan} == {uv.vacancy_id for uv in rows}

    v0 = await session.get(Vacancy, rows[0].vacancy_id)
    assert (await daily.recheck_vacancy(session, v0.id, 200, page_html(int(v0.external_id), "x", archived=True), now))["archived"]
    assert rows[0].status == "archived" and "🔒" in no_outside_world[-1][1]
    # Живая вакансия — без изменений, но проверена сегодня: в план больше не попадает
    v1 = await session.get(Vacancy, rows[1].vacancy_id)
    assert not (await daily.recheck_vacancy(session, v1.id, 200, page_html(int(v1.external_id), "x"), now))["archived"]
    assert await daily.recheck_plan(session, now) == []

    # 404 — вакансию удалили
    user2, _, rows2 = await setup_cards(session, monkeypatch, 706, n=1)
    assert (await daily.recheck_vacancy(session, rows2[0].vacancy_id, 404, "", now))["archived"]

    # Капча — стоп всего сбора, план пуст
    user3, _, rows3 = await setup_cards(session, monkeypatch, 707, n=1)
    out = await daily.recheck_vacancy(session, rows3[0].vacancy_id, 200, "<html>captcha</html>", now)
    assert out.get("stop") and await daily.recheck_plan(session, now + timedelta(days=1)) == []


async def test_summary_once_a_day_at_nine_local(session, monkeypatch, no_outside_world) -> None:
    user, qa, rows = await setup_cards(session, monkeypatch, 708, n=2)
    base = datetime.now(UTC).replace(hour=0, minute=30, second=0, microsecond=0) + timedelta(days=1)  # 07:30 в Бангкоке
    assert await daily.summaries(session, base) == 0
    nine = base + timedelta(hours=2)  # 09:30 в Бангкоке
    before = len(no_outside_world)
    assert await daily.summaries(session, nine) >= 1
    mine = [text for chat, text in no_outside_world[before:] if chat == user.tg_id]
    assert len(mine) == 1 and "Сводка за сутки" in mine[0] and "🧪 QA" in mine[0]
    assert await daily.summaries(session, nine + timedelta(hours=5)) == 0
    assert await daily.summaries(session, nine + timedelta(days=1)) >= 1


async def test_cleanup_keeps_open_cards(session, monkeypatch) -> None:
    user, qa, rows = await setup_cards(session, monkeypatch, 709, n=1)
    old = await make_vacancy(session, 70999)
    old.created_at = datetime.now(UTC) - timedelta(days=40)
    open_v = await session.get(Vacancy, rows[0].vacancy_id)
    open_v.created_at = datetime.now(UTC) - timedelta(days=40)
    session.add(Run(kind="schedule", started_at=datetime.now(UTC) - timedelta(days=100)))
    await session.commit()
    out = await daily.cleanup(session, datetime.now(UTC))
    await session.refresh(old)
    await session.refresh(open_v)
    assert old.description is None and open_v.description and out["runs"] >= 1


async def test_admin_health(session, monkeypatch) -> None:
    await setup_cards(session, monkeypatch, 710, n=1)
    session.add(Run(kind="schedule", status="ok", stats={"found": 5, "new": 1}))
    await session.commit()
    h = await admin.health(session, datetime.now(UTC))
    assert h.runs_ok >= 1 and h.last_run is not None and h.to_score == 0
