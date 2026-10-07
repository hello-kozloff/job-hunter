"""Оценка и карточки: одна карточка на несколько резюме, теневой режим, кнопки, «Почему?», ЧС, изоляция, лимиты."""

from sqlalchemy import select

from app.db.models import Alert, Blacklist, Match, Profile, Resume, UserVacancy, Vacancy
from app.domain import card
from app.domain.llm import score as prompts
from app.services import cards, llm, profiles, score, users
from tests.test_collect import qa_config


async def make_user(session, tg_id: int):
    user = await users.create(session, tg_id, None, f"U{tg_id}", None)
    user.tz = "Asia/Bangkok"
    return user


async def make_profile(session, user, title: str, shadow: bool = True, status: str = "active") -> Profile:
    p = Profile(user_id=user.id, title=title, emoji="🧪", status=status, shadow=shadow)
    session.add(p)
    await session.flush()
    session.add(Resume(profile_id=p.id, source="text", raw_text=f"Резюме {title}, тел. +7 999 123-45-67",
                       structured={"headline": f"{title} инженер", "years": 3, "seniority": "middle"}))
    await profiles.save_version(session, p, qa_config(), created_by="user")
    return p


async def make_vacancy(session, vid: int, **kw) -> Vacancy:
    v = Vacancy(external_id=str(vid), dup_key=f"hh:id:{vid}", title=kw.pop("title", f"QA {vid}"),
                company=kw.pop("company", "Рога и копыта"), company_id=kw.pop("company_id", "77"),
                url=f"https://hh.ru/vacancy/{vid}", description="Автотесты на Playwright", page_status="ok", **kw)
    session.add(v)
    await session.flush()
    return v


async def passed(session, profile: Profile, v: Vacancy) -> Match:
    m = Match(profile_id=profile.id, vacancy_id=v.id, filter_status="passed", config_id=profile.active_config_id)
    session.add(m)
    await session.commit()
    return m


def fake_llm(monkeypatch, answers: dict[str, str] | None = None, error: Exception | None = None):
    """answers: заголовок резюме → решение. Записывает промпты, которые ушли в нейросеть."""
    calls = []

    async def ask(session, *, kind, system, prompt, schema, provider="gemini", user_id=None, profile_id=None, temperature=0.2):
        calls.append((system, prompt))
        if error:
            raise error
        decision = next((d for head, d in (answers or {}).items() if head in system), "apply")
        return prompts.Verdict(reason=f"причина {decision}", decision=decision)

    monkeypatch.setattr(llm, "ask", ask)
    return calls


async def test_one_card_for_two_resumes(session, monkeypatch, no_outside_world) -> None:
    user = await make_user(session, 501)
    qa = await make_profile(session, user, "QA")
    fe = await make_profile(session, user, "Frontend")
    v = await make_vacancy(session, 1)
    await passed(session, qa, v)
    await passed(session, fe, v)
    calls = fake_llm(monkeypatch, {"QA инженер": "apply", "Frontend инженер": "maybe"})

    result = await score.run(session, budget=10, pause=0)

    assert result == {"scored": 2, "remaining": 0, "stopped": None}
    # Контакты из резюме в нейросеть не уходят; вакансия — в блоке <vacancy>
    assert all("999" not in system for system, _ in calls) and all("<vacancy>" in p for _, p in calls)
    rows = list(await session.scalars(select(UserVacancy).where(UserVacancy.user_id == user.id)))
    assert len(rows) == 1 and rows[0].status == "waiting" and rows[0].tg_card_id
    text = no_outside_world[-1][1]
    assert "🧪 QA: 🟢 apply" in text and "🧪 Frontend: 🟡 maybe" in text


async def test_quiet_skip_without_shadow(session, monkeypatch, no_outside_world) -> None:
    user = await make_user(session, 502)
    qa = await make_profile(session, user, "QA", shadow=False)
    v = await make_vacancy(session, 2)
    await passed(session, qa, v)
    fake_llm(monkeypatch, {"QA": "skip"})
    await score.run(session, budget=10, pause=0)
    uv = await session.scalar(select(UserVacancy).where(UserVacancy.user_id == user.id))
    assert uv.status == "quiet" and uv.tg_card_id is None and not no_outside_world

    # В теневом режиме skip тоже приходит карточкой
    qa.shadow = True
    v2 = await make_vacancy(session, 3)
    await passed(session, qa, v2)
    await score.run(session, budget=10, pause=0)
    assert "🔴 skip" in no_outside_world[-1][1]


async def test_paused_and_stale_not_scored(session, monkeypatch) -> None:
    user = await make_user(session, 503)
    paused = await make_profile(session, user, "QA", status="paused")
    await passed(session, paused, await make_vacancy(session, 4))
    fake_llm(monkeypatch)
    assert (await score.run(session, budget=10, pause=0))["scored"] == 0


async def test_buttons_pick_resume_ask_and_ban(session, monkeypatch, no_outside_world) -> None:
    user = await make_user(session, 504)
    qa = await make_profile(session, user, "QA")
    fe = await make_profile(session, user, "Frontend")
    v = await make_vacancy(session, 5)
    await passed(session, qa, v)
    await passed(session, fe, v)
    fake_llm(monkeypatch, {"QA инженер": "skip", "Frontend инженер": "maybe"})
    await score.run(session, budget=10, pause=0)
    uv = await session.scalar(select(UserVacancy).where(UserVacancy.user_id == user.id))

    # ✅ при двух резюме — сначала выбор резюме
    out = await cards.press(session, user, uv.id, "apply")
    assert out.toast == "С каким резюме откликаться?" and uv.my_decision is None
    assert len(out.markup.inline_keyboard) == 3  # два резюме + «Назад»

    # Выбрал QA (нейросеть: skip) → решение записано, «Почему?» спрошено
    out = await cards.press(session, user, uv.id, "apply", str(qa.id))
    assert uv.my_decision == "apply" and uv.status == "approved" and uv.chosen_profile_id == qa.id
    assert "Почему?" in out.ask and "🔴 skip" in out.ask and "👤 ✅ Откликнусь · 🧪 QA" in out.text
    await cards.set_ask(session, uv, 9001)
    assert (await cards.set_reason(session, user, 9001, "Playwright — мой стек")).my_reason == "Playwright — мой стек"

    # Чужое резюме в arg — отказ
    other = await make_profile(session, await make_user(session, 505), "Чужое")
    assert await cards.press(session, user, uv.id, "apply", str(other.id)) is None

    # 🚫 В ЧС во все резюме → компания в чёрном списке обоих, вакансия — ❌
    out = await cards.press(session, user, uv.id, "ban", "all")
    assert uv.my_decision == "skip" and uv.my_reason == card.BAN_REASON
    bl = {b.profile_id for b in await session.scalars(select(Blacklist).where(Blacklist.company_id == "77"))}
    assert bl == {qa.id, fe.id}
    await cards.press(session, user, uv.id, "ban", "all")  # повтор — без дублей
    assert len(list(await session.scalars(select(Blacklist).where(Blacklist.company_id == "77")))) == 2

    # ↩️ Изменить → снова кнопки выбора, решение то же
    out = await cards.press(session, user, uv.id, "edit")
    assert len(out.markup.inline_keyboard) == 2 and uv.my_decision == "skip"


async def test_other_user_cannot_press(session, monkeypatch) -> None:
    owner = await make_user(session, 506)
    qa = await make_profile(session, owner, "QA")
    await passed(session, qa, await make_vacancy(session, 6))
    fake_llm(monkeypatch)
    await score.run(session, budget=10, pause=0)
    uv = await session.scalar(select(UserVacancy).where(UserVacancy.user_id == owner.id))
    stranger = await make_user(session, 507)
    assert await cards.press(session, stranger, uv.id, "skip") is None
    assert await cards.set_reason(session, stranger, uv.tg_card_id, "x") is None


async def test_single_resume_apply_without_pick(session, monkeypatch) -> None:
    user = await make_user(session, 508)
    qa = await make_profile(session, user, "QA")
    await passed(session, qa, await make_vacancy(session, 7))
    fake_llm(monkeypatch, {"QA": "apply"})
    await score.run(session, budget=10, pause=0)
    uv = await session.scalar(select(UserVacancy).where(UserVacancy.user_id == user.id))
    out = await cards.press(session, user, uv.id, "apply")
    assert uv.chosen_profile_id == qa.id and not out.ask  # совпало с нейросетью — не спрашиваем
    out = await cards.press(session, user, uv.id, "earlier")
    assert uv.status == "applied" and not out.ask


async def test_quota_releases_and_alerts(session, monkeypatch, no_outside_world) -> None:
    user = await make_user(session, 509)
    qa = await make_profile(session, user, "QA")
    m = await passed(session, qa, await make_vacancy(session, 8))

    fake_llm(monkeypatch, error=llm.LlmUnavailable("лимит запросов к нейросети", "minute"))
    result = await score.run(session, budget=10, pause=0)
    await session.refresh(m)
    assert result["stopped"] == "minute" and result["remaining"] == 1 and m.scoring_at is None
    assert await session.scalar(select(Alert.id).limit(1)) is None  # минутный лимит — без тревоги

    fake_llm(monkeypatch, error=llm.LlmUnavailable("лимит запросов к нейросети", "day"))
    await score.run(session, budget=10, pause=0)
    assert await session.scalar(select(Alert.id).limit(1)) is not None

    # Ответ не по схеме — оценка «⚠️ не оценено», карточка всё равно приходит
    fake_llm(monkeypatch, error=llm.LlmError("нейросеть ответила не по схеме"))
    await score.run(session, budget=10, pause=0)
    await session.refresh(m)
    assert m.decision == "error" and any("⚠️ не оценено" in text for _, text in no_outside_world)
    assert "снова работает" in no_outside_world[-1][1]  # оценка пошла — тревога закрыта


def test_quota_detection() -> None:
    assert llm._quota(Exception("429 RESOURCE_EXHAUSTED GenerateRequestsPerDayPerProjectPerModel")) == "day"
    assert llm._quota(Exception("429 RESOURCE_EXHAUSTED PerMinute")) == "minute"
    assert llm._quota(Exception("500 internal")) is None
