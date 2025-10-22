from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.change_log import ChangeLog
from app.schemas.change_log import ChangeLogCreate

async def create_change_log(db: AsyncSession, change_log: ChangeLogCreate):
    db_change_log = ChangeLog(**change_log.model_dump())
    db.add(db_change_log)
    await db.commit()
    await db.refresh(db_change_log)
    return db_change_log

async def get_change_logs_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(ChangeLog)
        .filter(ChangeLog.device_id == device_id)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()
