from datetime import UTC, datetime

import pytest

from app.domain import timezones


@pytest.mark.parametrize(
    ("text", "tz"),
    [
        ("Asia/Bangkok", "Asia/Bangkok"),
        ("asia/bangkok", "Asia/Bangkok"),
        ("Бангкок", "Asia/Bangkok"),
        ("спб", "Europe/Moscow"),
        ("+7", "Etc/GMT-7"),
        ("UTC+7", "Etc/GMT-7"),
        ("utc -5", "Etc/GMT+5"),
        ("UTC+0", "Etc/UTC"),
        ("мск+4", "Etc/GMT-7"),
        ("мск-1", "Etc/GMT-2"),
        ("America/New York", "America/New_York"),
    ],
)
def test_parse(text: str, tz: str) -> None:
    assert timezones.parse_tz(text) == tz
    assert timezones.is_valid(tz)


@pytest.mark.parametrize("text", ["", "марс", "+15", "Asia/Nowhere", "utc+7:30"])
def test_parse_rejects(text: str) -> None:
    assert timezones.parse_tz(text) is None


def test_popular_are_valid() -> None:
    assert all(timezones.is_valid(tz) for _, tz in timezones.POPULAR)


def test_describe() -> None:
    now = datetime(2026, 10, 8, tzinfo=UTC)
    assert timezones.describe("Asia/Bangkok", now) == "Бангкок (UTC+7)"
    assert timezones.describe("Etc/GMT-7", now) == "Etc/GMT-7 (UTC+7)"
    assert timezones.describe("Asia/Kolkata", now) == "Asia/Kolkata (UTC+5:30)"
