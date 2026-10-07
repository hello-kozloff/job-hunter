"""Резюме по ссылке hh: разовый запрос к публичной странице (не через n8n — это действие пользователя, не сбор).

Видно ли резюме без входа, зависит от настроек видимости у владельца; не видно — просим PDF.
"""

import re

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import FetchLog
from app.domain import resume_text
from app.domain.resume_text import ResumeTextError

URL = re.compile(r"https?://(?:[\w-]+\.)?(?:hh\.ru|hh\.kz|headhunter\.(?:ge|kg|uz)|rabota\.by)/resume/([0-9a-f]{20,64})", re.I)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/141.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
}


def find_url(text: str) -> str | None:
    m = URL.search(text)
    return m.group(0) if m else None


async def fetch_text(session: AsyncSession, url: str) -> str:
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=20, follow_redirects=False) as client:
            r = await client.get(url)
    except httpx.HTTPError as e:
        session.add(FetchLog(kind="resume", url=url, ok=False, error=str(e)[:500]))
        await session.commit()
        raise ResumeTextError("hh не ответил, попробуй позже или пришли PDF") from e
    ok = r.status_code == 200
    session.add(FetchLog(kind="resume", url=url, http_status=r.status_code, ok=ok, bytes=len(r.content)))
    await session.commit()
    if not ok:
        raise ResumeTextError(
            "Резюме по ссылке не открывается без входа на hh. Скачай его на hh в PDF («Скачать» → PDF) и пришли файлом"
        )
    text = resume_text.from_html(r.text)
    # Вместо резюме может прийти страница входа или «резюме скрыто» со статусом 200
    if not re.search(r"опыт работы|ключевые навыки|work experience", text, re.I):
        raise ResumeTextError(
            "По ссылке hh не видно резюме (скрыто или нужен вход). Скачай его на hh в PDF и пришли файлом"
        )
    return text
