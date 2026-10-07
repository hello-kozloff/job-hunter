from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import session_scope

router = APIRouter()


@router.get("/health")
async def health(session: AsyncSession = Depends(session_scope)) -> dict[str, str]:
    await session.execute(text("select 1"))
    return {"status": "ok"}
