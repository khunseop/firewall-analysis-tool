"""모니터링/오케스트레이션 도구용 헬스체크 엔드포인트. 인증 불필요."""
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db.session import SessionLocal

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health_check():
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception:
        logger.exception("헬스체크: DB 연결 실패")
        return JSONResponse({"status": "error", "database": "error"}, status_code=503)
    return {"status": "ok", "database": "ok"}
