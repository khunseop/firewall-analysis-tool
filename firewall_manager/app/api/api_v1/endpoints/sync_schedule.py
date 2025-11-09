from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas
from app.db.session import get_db
from app.services.scheduler import sync_scheduler

router = APIRouter()

@router.post("/", response_model=schemas.SyncSchedule)
async def create_sync_schedule(
    schedule_in: schemas.SyncScheduleCreate,
    db: AsyncSession = Depends(get_db)
):
    """스케줄 생성"""
    # 이름 중복 확인
    existing = await crud.sync_schedule.get_sync_schedule_by_name(db, name=schedule_in.name)
    if existing:
        raise HTTPException(status_code=400, detail="이미 존재하는 스케줄 이름입니다.")
    
    # 장비 존재 확인
    for device_id in schedule_in.device_ids:
        device = await crud.device.get_device(db, device_id=device_id)
        if not device:
            raise HTTPException(status_code=404, detail=f"장비 ID {device_id}를 찾을 수 없습니다.")
    
    created_schedule = await crud.sync_schedule.create_sync_schedule(db=db, schedule=schedule_in)
    # 스케줄러에 추가
    if created_schedule.enabled:
        sync_scheduler.add_schedule(created_schedule)
    return created_schedule

@router.get("/", response_model=List[schemas.SyncSchedule])
async def read_sync_schedules(
    skip: int = 0,
    limit: int | None = None,
    db: AsyncSession = Depends(get_db)
):
    """스케줄 목록 조회"""
    return await crud.sync_schedule.get_sync_schedules(db, skip=skip, limit=limit)

@router.get("/{schedule_id}", response_model=schemas.SyncSchedule)
async def read_sync_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db)
):
    """스케줄 상세 조회"""
    schedule = await crud.sync_schedule.get_sync_schedule(db, schedule_id=schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="스케줄을 찾을 수 없습니다.")
    return schedule

@router.put("/{schedule_id}", response_model=schemas.SyncSchedule)
async def update_sync_schedule(
    schedule_id: int,
    schedule_in: schemas.SyncScheduleUpdate,
    db: AsyncSession = Depends(get_db)
):
    """스케줄 수정"""
    schedule = await crud.sync_schedule.get_sync_schedule(db, schedule_id=schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="스케줄을 찾을 수 없습니다.")
    
    # 이름 변경 시 중복 확인
    if schedule_in.name and schedule_in.name != schedule.name:
        existing = await crud.sync_schedule.get_sync_schedule_by_name(db, name=schedule_in.name)
        if existing:
            raise HTTPException(status_code=400, detail="이미 존재하는 스케줄 이름입니다.")
    
    # 장비 존재 확인
    if schedule_in.device_ids:
        for device_id in schedule_in.device_ids:
            device = await crud.device.get_device(db, device_id=device_id)
            if not device:
                raise HTTPException(status_code=404, detail=f"장비 ID {device_id}를 찾을 수 없습니다.")
    
    updated_schedule = await crud.sync_schedule.update_sync_schedule(db=db, db_obj=schedule, obj_in=schedule_in)
    # 스케줄러 업데이트
    await sync_scheduler.update_schedule(updated_schedule)
    return updated_schedule

@router.delete("/{schedule_id}", response_model=schemas.SyncSchedule)
async def delete_sync_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db)
):
    """스케줄 삭제"""
    schedule = await crud.sync_schedule.delete_sync_schedule(db, schedule_id=schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="스케줄을 찾을 수 없습니다.")
    # 스케줄러에서 제거
    sync_scheduler.remove_schedule(schedule_id)
    return schedule

