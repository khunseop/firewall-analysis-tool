from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas
from app.db.session import get_db

router = APIRouter()

@router.post("/", response_model=schemas.NotificationLog)
async def create_notification(
    notification_in: schemas.NotificationLogCreate,
    db: AsyncSession = Depends(get_db)
):
    """알림 로그 생성"""
    return await crud.notification_log.create_notification_log(db, notification_in)

@router.get("/", response_model=schemas.NotificationLogListResponse)
async def get_notifications(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    category: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """알림 로그 목록 조회"""
    logs, total = await crud.notification_log.get_notification_logs(
        db, skip=skip, limit=limit, category=category, type=type
    )
    
    return {
        "items": logs,
        "total": total
    }


