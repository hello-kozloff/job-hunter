"""Разбор hh — сверка с v1 на тех же сохранённых страницах (fixtures/ не в git: тесты пропускаются без них).

Эталон v1: node scripts/run-code-node.mjs n8n/w1-collector/parse-search.js fixtures/search-p0.html \
  --ref 'Plan={"firstRun":false}' --out fixtures/v1-search-p0.json
"""

import json
from pathlib import Path

import pytest

from app.domain.hh import parse

FIX = Path("/fixtures")
need = pytest.mark.skipif(not (FIX / "search-p0.html").exists(), reason="нет fixtures/ (не в git)")


@need
def test_search_matches_v1() -> None:
    page = parse.parse_search(200, (FIX / "search-p0.html").read_text())
    v1 = json.loads((FIX / "v1-search-p0.json").read_text())
    v1 = (v1[0]["json"] if isinstance(v1, list) else v1)["vacancies"]
    assert page.ok and page.total == 162 and page.count == 100
    assert [r.external_id for r in page.records] == [v["external_id"] for v in v1]
    for r, v in zip(page.records, v1, strict=True):
        assert r.dup_key == v["dup_key"]
        assert r.title == v["title"] and r.company == v["company"]
        assert ", ".join(r.areas) == v["areas"]
        assert ",".join(r.work_formats) == v["work_formats"]
        assert ",".join(r.languages) == v["languages"]
        assert ",".join(r.contract) == v["contract"]
        assert ", ".join(r.key_skills) == v["key_skills"]
        assert r.snippet == v["snippet"]
        assert (r.salary_from, r.salary_to, r.currency, r.salary_gross) == (
            v["salary_from"], v["salary_to"], v["currency"], v["salary_gross"]
        )
        assert r.responses == v["responses"] and r.has_test == v["has_test"]
        assert r.published_at is not None and r.published_at.isoformat(timespec="milliseconds") == v["published_at"]


@need
def test_vacancy_page() -> None:
    page = parse.parse_vacancy(200, (FIX / "vacancy.html").read_text())
    assert page.error is None and page.vacancy_id and len(page.description) > 200
    assert "<" not in page.description


def test_block_detection() -> None:
    captcha = Path(__file__).parent / "data" / "synthetic-captcha.html"
    text = captcha.read_text() if captcha.exists() else "<html>captcha робот</html>"
    page = parse.parse_search(200, text)
    assert not page.ok and "капчу" in page.reason
    assert not parse.parse_search(302, "", "https://hh.ru/account/captcha").ok
    assert "HTTP 302" in parse.parse_search(302, "", "https://x").reason
    assert not parse.parse_search(200, '<template id="HH-Lux-InitialState">{bad</template>').ok
    assert not parse.parse_search(200, '<template id="HH-Lux-InitialState">{}</template>').ok
    empty = parse.parse_search(200, '<template id="HH-Lux-InitialState">{"vacancySearchResult":{"vacancies":[],"totalResults":0}}</template>')
    assert empty.ok and empty.records == []
    assert parse.parse_vacancy(404, "").error == "страница: HTTP 404"


def test_entities_single_pass() -> None:
    state = {"vacancySearchResult": {"totalResults": 1, "vacancies": [
        {"vacancyId": 1, "name": "QA &quot;Pro&quot;", "company": {"id": 5, "visibleName": "A"}}
    ]}}
    # &amp;quot; должно стать &quot; (текст), а не кавычкой, ломающей JSON
    raw = json.dumps(state).replace('"', "&quot;").replace("&quot;Pro&quot;", "&amp;quot;Pro&amp;quot;")
    page = parse.parse_search(200, f'<template id="HH-Lux-InitialState">{raw}</template>')
    assert page.ok and page.records[0].title == "QA &quot;Pro&quot;"
