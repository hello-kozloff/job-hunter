"""Эндпоинты для n8n v2. Доступ — только с секретом INTERNAL_TOKEN (заголовок X-Internal-Token)."""

import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import session_scope
from app.services import alerts, collect, notify, score


def require_internal(x_internal_token: str = Header(default="")) -> None:
    expected = get_settings().internal_token
    if not expected or not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail="bad internal token")


router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal)])


def now() -> datetime:
    return datetime.now(UTC)


@router.get("/ping")
async def ping() -> dict[str, bool]:
    return {"ok": True}


class PlanIn(BaseModel):
    kind: str = "schedule"
    profile_id: int | None = None
    chat_id: int | None = None


@router.post("/collect/plan")
async def collect_plan(body: PlanIn, session: AsyncSession = Depends(session_scope)) -> dict:
    run_id, tasks, why = await collect.plan(session, now(), body.kind, body.profile_id, body.chat_id)
    if run_id is None and body.chat_id and why:
        # Сбор из бота не начался — пользователь должен узнать почему
        await notify.send(body.chat_id, f"😕 Сбор не запущен: {why}")
    return {"run_id": run_id, "tasks": [{"run_id": run_id, "search_id": t.search_id, "url": t.url} for t in tasks], "why": why}


class SearchIn(BaseModel):
    run_id: int
    search_id: int
    status: int
    html: str = ""
    location: str | None = None


@router.post("/collect/search")
async def collect_search(body: SearchIn, session: AsyncSession = Depends(session_scope)) -> dict:
    result = await collect.ingest_search(session, body.run_id, body.search_id, body.status, body.html, body.location, now())
    for p in result["pages"]:
        p["run_id"] = body.run_id
    return result


class VacancyIn(BaseModel):
    run_id: int
    vacancy_id: int
    status: int
    html: str = ""


@router.post("/collect/vacancy")
async def collect_vacancy(body: VacancyIn, session: AsyncSession = Depends(session_scope)) -> dict:
    return await collect.ingest_vacancy(session, body.run_id, body.vacancy_id, body.status, body.html, now())


class FinishIn(BaseModel):
    run_id: int | None = None


@router.post("/collect/finish")
async def collect_finish(body: FinishIn, session: AsyncSession = Depends(session_scope)) -> dict:
    return await collect.finish(session, body.run_id, now()) if body.run_id else {}


@router.post("/score/run")
async def score_run(session: AsyncSession = Depends(session_scope)) -> dict:
    """Оценить ждущие совпадения (≈100 с за вызов; остаток — в следующий вызов n8n)."""
    return await score.run(session)


class AlertIn(BaseModel):
    source: str
    message: str


@router.post("/alert")
async def alert(body: AlertIn, session: AsyncSession = Depends(session_scope)) -> dict:
    a = await alerts.raise_alert(session, body.source[:64], body.message[:3000], now())
    return {"id": a.id, "hits": a.hits}
