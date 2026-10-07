from app.domain.filter import engine
from app.domain.profile_config import Rule, Term


def rule(**kw) -> Rule:
    base = {"id": "r", "label": "L", "stage": "search", "kind": "reject", "match": []}
    return Rule.model_validate(base | kw)


def term(fields, *patterns) -> dict:
    return {"fields": fields if isinstance(fields, list) else [fields], "patterns": list(patterns)}


def test_patterns_word_bounds_cyrillic_and_wildcards() -> None:
    m = lambda p, s: engine.compile_pattern(p).search(s) is not None  # noqa: E731
    assert m("java", "Java Developer") and not m("java", "JavaScript разработчик")
    assert m("тестировщ*", "Ведущий тестировщик ПО") and not m("тест", "тестировщик")
    assert m(".net", "ASP.NET Core") and m("c#", "C#/.NET разработчик") and not m("c#", "abc#")
    assert m("next.js", "React / Next.js") and not m("next.js", "nextXjs")
    assert m("стаж*р*", "Стажёр-разработчик") and m("1с", "Программист 1С")
    assert m("re:\\bgo(lang)?\\b", "Golang developer")


def test_reject_require_and_unless() -> None:
    lead = rule(
        match=[term("title", "lead", "тимлид*")],
        unless=[[term("title", "senior", "старш*")]],
    )
    assert engine.rule_fires(lead, {"title": "Frontend Team Lead"})
    assert not engine.rule_fires(lead, {"title": "Senior Frontend Lead"})
    assert not engine.rule_fires(lead, {"title": "Frontend developer"})

    stack = rule(
        kind="require",
        stage="page",
        match=[term(["title", "skills", "description"], "react*", "vue*")],
        # AI-вакансии на JS/TS — исключение: AI в названии И JS/TS в описании
        unless=[[term("title", "ai", "llm"), term("description", "typescript", "node.js")]],
    )
    assert not engine.rule_fires(stack, {"title": "Frontend", "skills": ["React"], "description": ""})
    assert engine.rule_fires(stack, {"title": "Backend", "skills": [], "description": "Python"})
    assert not engine.rule_fires(stack, {"title": "AI engineer", "description": "Node.js, LLM"})
    assert engine.rule_fires(stack, {"title": "AI engineer", "description": "Python, LLM"})


def test_reasons_by_stage_and_disabled() -> None:
    rules = [
        rule(id="a", label="Angular", match=[term("title", "angular")]),
        rule(id="b", label="без опыта", match=[term("experience", "noExperience")], enabled=False),
        rule(id="c", label="только Python", stage="page", match=[term("description", "django")]),
    ]
    v = {"title": "Angular dev", "experience": "noExperience", "description": "Django"}
    assert engine.reasons(rules, v, "search") == ["Angular"]
    assert engine.reasons(rules, v, "page") == ["только Python"]


def test_validate_patterns() -> None:
    bad = rule(match=[term("title", "re:(", "ok")])
    assert engine.validate_patterns([bad]) and not engine.validate_patterns([rule(match=[term("title", "ok")])])
