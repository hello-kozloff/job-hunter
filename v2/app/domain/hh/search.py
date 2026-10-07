"""Поисковый запрос hh /search/vacancy по настройкам резюме — порт n8n/shared/search.js на SearchConfig.

Одинаковые запросы разных резюме дают один URL → один запрос к hh (таблица searches, ключ — хеш URL).
"""

import hashlib
from urllib.parse import quote

from app.domain.profile_config import SearchConfig

SEARCH_URL = "https://hh.ru/search/vacancy"


def _term(word: str) -> str:
    # Слово с пробелом — в кавычках, иначе язык запросов hh разобьёт его на два
    return f'"{word}"' if " " in word else word


def search_text(cfg: SearchConfig) -> str:
    parts = [_term(w) for w in cfg.anywhere]
    if cfg.in_name:
        parts.append(f"NAME:({' OR '.join(_term(w) for w in cfg.in_name)})")
    return " OR ".join(parts)


def query(cfg: SearchConfig, page: int = 0) -> list[tuple[str, str]]:
    q: list[tuple[str, str]] = [("text", search_text(cfg))]
    q += [("professional_role", str(r)) for r in sorted(set(cfg.roles))]
    q += [("work_format", f) for f in sorted(set(cfg.work_format))]
    if cfg.education_not_required:
        q.append(("education", "not_required_or_not_specified"))
    q += [
        ("search_period", str(cfg.period)),
        ("order_by", "publication_time"),
        ("items_on_page", "100"),
        ("enable_snippets", "true"),
        ("ored_clusters", "true"),
        ("page", str(page)),
    ]
    return q


def url(cfg: SearchConfig, page: int = 0) -> str:
    return SEARCH_URL + "?" + "&".join(f"{k}={quote(v, safe='')}" for k, v in query(cfg, page))


def url_hash(u: str) -> str:
    return hashlib.sha256(u.encode()).hexdigest()
