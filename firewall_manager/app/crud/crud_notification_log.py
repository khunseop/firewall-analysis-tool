from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, desc

from app.models.notification_log import NotificationLog
from app.schemas.notification_log import NotificationLogCreate

async def create_notification_log(db: AsyncSession, notification_log: NotificationLogCreate):
    """알림 로그 생성"""
    db_notification_log = NotificationLog(**notification_log.model_dump())
    db.add(db_notification_log)
    await db.commit()
    await db.refresh(db_notification_log)
    return db_notification_log

async def get_notification_logs(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    category: Optional[str] = None,
    type: Optional[str] = None
) -> tuple[List[NotificationLog], int]:
    """알림 로그 목록 조회"""
    query = select(NotificationLog)
    count_query = select(func.count()).select_from(NotificationLog)
    
    if category:
        query = query.filter(NotificationLog.category == category)
        count_query = count_query.filter(NotificationLog.category == category)
    
    if type:
        query = query.filter(NotificationLog.type == type)
        count_query = count_query.filter(NotificationLog.type == type)
    
    # 최신순 정렬
    query = query.order_by(desc(NotificationLog.timestamp)).offset(skip).limit(limit)
    
    result = await db.execute(query)
    logs = result.scalars().all()
    
    count_result = await db.execute(count_query)
    total = count_result.scalar()
    
    return logs, total


