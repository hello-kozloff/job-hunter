"""Эндпоинты для n8n v2. Доступ — только с секретом INTERNAL_TOKEN (заголовок X-Internal-Token)."""

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException

from app.config import get_settings


def require_internal(x_internal_token: str = Header(default="")) -> None:
    expected = get_settings().internal_token
    if not expected or not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail="bad internal token")


router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal)])


@router.get("/ping")
async def ping() -> dict[str, bool]:
    return {"ok": True}
