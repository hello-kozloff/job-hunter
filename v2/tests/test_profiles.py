"""Профили: создание из резюме (нейросеть подменена), версии настроек, правка, изоляция пользователей."""

import pytest

from app.domain.llm import draft as prompts
from app.services import llm, profiles, users

RESUME = "QA Automation Engineer, 3 года. Playwright, TypeScript, Jest. Опыт работы: Acme, тг @qa_nik. " * 5

DRAFT = {
    "title": "QA Automation",
    "emoji": "🧪",
    "resume": {
        "headline": "QA Automation, Playwright + TS",
        "seniority": "middle",
        "years": 3,
        "skills_commercial": ["Playwright", "TypeScript"],
        "skills_other": [],
        "experience": [{"company": "Acme", "role": "QA", "period": "2023–2026", "highlights": ["автотесты"]}],
        "education": "среднее",
        "languages": ["русский"],
        "wishes": "",
    },
    "search": {"anywhere": ["QA"], "in_name": ["тестировщик", "QA"], "roles": [124], "period": 1},
    "filter": {
        "rules": [
            {"id": "junior", "label": "junior", "stage": "search", "kind": "reject",
             "match": [{"fields": ["title"], "patterns": ["junior"]}]},
            {"id": "junior", "label": "дубль id", "stage": "search", "kind": "reject",
             "match": [{"fields": ["title"], "patterns": ["intern"]}]},
            {"id": "Bad:ID", "label": "Java", "stage": "search", "kind": "reject",
             "match": [{"fields": ["title"], "patterns": ["java"]}]},
        ]
    },
    "llm": {"apply": ["автотесты на TS"], "maybe": ["ручное"], "skip": ["только Java"]},
}


@pytest.fixture
def fake_llm(monkeypatch):
    calls = []

    async def ask(session, *, kind, system, prompt, schema, **kw):
        calls.append((kind, prompt))
        if schema is prompts.Draft:
            return prompts.Draft.model_validate(DRAFT)
        return fake_llm.edit  # noqa: F821 — задаётся тестом

    monkeypatch.setattr(llm, "ask", ask)
    return calls


async def two_users(session):
    a = await users.ensure_admin(session, 1, "a", "A")
    b = await users.create(session, 2, "b", "B", invited_by=a.id)
    await session.commit()
    return a, b


async def test_create_from_text(session, fake_llm) -> None:
    a, _ = await two_users(session)
    p = await profiles.create_from_text(session, a, "text", None, RESUME)
    loaded = await profiles.load(session, a.id, p.id)
    assert (p.title, p.emoji, p.status, loaded.version) == ("QA Automation", "🧪", "draft", 1)
    assert [r.id for r in loaded.config.filter.rules] == ["junior", "junior_2", "bad_id"]
    assert loaded.config.letter.contact == "тг: @qa_nik"
    assert loaded.headline == "QA Automation, Playwright + TS"
    # В нейросеть контакты не уходят
    assert "@qa_nik" not in fake_llm[0][1]


async def test_other_user_cannot_see_profile(session, fake_llm) -> None:
    a, b = await two_users(session)
    p = await profiles.create_from_text(session, a, "text", None, RESUME)
    assert await profiles.load(session, b.id, p.id) is None
    assert await profiles.get_owned(session, b.id, p.id) is None
    assert await profiles.list_for_user(session, b.id) == []


async def test_toggle_and_edit_make_versions(session, fake_llm) -> None:
    a, _ = await two_users(session)
    p = await profiles.create_from_text(session, a, "text", None, RESUME)
    loaded = await profiles.load(session, a.id, p.id)
    assert await profiles.toggle_rule(session, loaded, "junior") == 2
    assert await profiles.toggle_rule(session, loaded, "nope") is None
    loaded = await profiles.load(session, a.id, p.id)
    assert not loaded.config.filter.rules[0].enabled

    new_filter = loaded.config.filter.model_copy(deep=True)
    new_filter.max_responses = 0
    edit = prompts.ConfigEdit(
        changes=["порог откликов выключен"], question="", search=loaded.config.search, filter=new_filter, llm=loaded.config.llm
    )
    assert await profiles.apply_edit(session, loaded, edit, "без порога") == 3
    assert (await profiles.load(session, a.id, p.id)).config.filter.max_responses == 0


async def test_delete(session, fake_llm) -> None:
    a, _ = await two_users(session)
    p = await profiles.create_from_text(session, a, "text", None, RESUME)
    await profiles.delete(session, p)
    assert await profiles.list_for_user(session, a.id) == []


def test_llm_schemas_have_no_recursion() -> None:
    """Схемы уходят в Gemini как JSON Schema — без циклических ссылок."""
    import json

    for schema in (prompts.Draft, prompts.ConfigEdit):
        s = schema.model_json_schema()
        for name, d in s.get("$defs", {}).items():
            assert f'"#/$defs/{name}"' not in json.dumps(d), name


def test_roles_catalog_covers_all_industries() -> None:
    from app.domain.hh import roles

    assert roles.ROLES[124] == "Тестировщик" and roles.ROLES[8] == "Администратор"
    assert len(roles.ROLES) > 150
    assert roles.known_roles([124, 99999, 124, 8]) == [124, 8]
    assert "Административный персонал:" in roles.catalog()
