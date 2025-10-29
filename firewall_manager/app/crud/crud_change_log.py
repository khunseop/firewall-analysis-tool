from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.change_log import ChangeLog
from app.schemas.change_log import ChangeLogCreate

async def create_change_log(db: AsyncSession, change_log: ChangeLogCreate):
    db_change_log = ChangeLog(**change_log.model_dump())
    db.add(db_change_log)
    return db_change_log

async def create_change_logs(db: AsyncSession, change_logs: List[ChangeLogCreate]):
    """Bulk create change logs."""
    db_change_logs = [ChangeLog(**cl.model_dump()) for cl in change_logs]
    db.add_all(db_change_logs)
    return db_change_logs

async def get_change_logs_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = 100):
    query = select(ChangeLog).filter(ChangeLog.device_id == device_id).offset(skip)
    if limit is not None:
        query = query.limit(limit)
    result = await db.execute(query)
    return result.scalars().all()
