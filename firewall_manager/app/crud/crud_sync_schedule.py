from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Optional

from app.models.sync_schedule import SyncSchedule
from app.schemas.sync_schedule import SyncScheduleCreate, SyncScheduleUpdate

async def get_sync_schedule(db: AsyncSession, schedule_id: int) -> Optional[SyncSchedule]:
    result = await db.execute(select(SyncSchedule).filter(SyncSchedule.id == schedule_id))
    return result.scalars().first()

async def get_sync_schedule_by_name(db: AsyncSession, name: str) -> Optional[SyncSchedule]:
    result = await db.execute(select(SyncSchedule).filter(SyncSchedule.name == name))
    return result.scalars().first()

async def get_sync_schedules(db: AsyncSession, skip: int = 0, limit: Optional[int] = None) -> List[SyncSchedule]:
    """스케줄 목록 조회"""
    stmt = select(SyncSchedule).order_by(SyncSchedule.created_at.desc())
    if skip:
        stmt = stmt.offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def get_enabled_sync_schedules(db: AsyncSession) -> List[SyncSchedule]:
    """활성화된 스케줄 목록 조회"""
    result = await db.execute(select(SyncSchedule).filter(SyncSchedule.enabled == True))
    return result.scalars().all()

async def create_sync_schedule(db: AsyncSession, schedule: SyncScheduleCreate) -> SyncSchedule:
    """스케줄 생성"""
    create_data = schedule.model_dump()
    db_schedule = SyncSchedule(**create_data)
    db.add(db_schedule)
    await db.commit()
    await db.refresh(db_schedule)
    return db_schedule

async def update_sync_schedule(
    db: AsyncSession, 
    db_obj: SyncSchedule, 
    obj_in: SyncScheduleUpdate
) -> SyncSchedule:
    """스케줄 업데이트"""
    obj_data = obj_in.model_dump(exclude_unset=True)
    obj_data["updated_at"] = datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
    for field, value in obj_data.items():
        setattr(db_obj, field, value)
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def delete_sync_schedule(db: AsyncSession, schedule_id: int) -> Optional[SyncSchedule]:
    """스케줄 삭제"""
    schedule = await get_sync_schedule(db, schedule_id)
    if schedule:
        await db.delete(schedule)
        await db.commit()
    return schedule

async def update_schedule_run_status(
    db: AsyncSession,
    schedule_id: int,
    status: str
) -> Optional[SyncSchedule]:
    """스케줄 실행 상태 업데이트"""
    schedule = await get_sync_schedule(db, schedule_id)
    if schedule:
        schedule.last_run_at = datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
        schedule.last_run_status = status
        schedule.updated_at = datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
        db.add(schedule)
        await db.commit()
        await db.refresh(schedule)
    return schedule

