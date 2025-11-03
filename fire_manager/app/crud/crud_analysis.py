
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List, Optional

from app.models.analysis import AnalysisTask, RedundancyPolicySet, AnalysisTaskStatus, AnalysisResult
from app.schemas.analysis import (
    AnalysisTaskCreate, AnalysisTaskUpdate, RedundancyPolicySetCreate,
    AnalysisResultCreate, AnalysisResultUpdate
)

# AnalysisTask CRUD
async def create_analysis_task(db: AsyncSession, *, obj_in: AnalysisTaskCreate) -> AnalysisTask:
    db_obj = AnalysisTask(**obj_in.model_dump())
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def get_analysis_task(db: AsyncSession, task_id: int) -> Optional[AnalysisTask]:
    result = await db.execute(select(AnalysisTask).filter(AnalysisTask.id == task_id))
    return result.scalars().first()

async def get_latest_analysis_task_by_device(db: AsyncSession, device_id: int) -> Optional[AnalysisTask]:
    result = await db.execute(
        select(AnalysisTask)
        .filter(AnalysisTask.device_id == device_id)
        .order_by(AnalysisTask.created_at.desc())
    )
    return result.scalars().first()

async def get_running_analysis_task(db: AsyncSession) -> Optional[AnalysisTask]:
    result = await db.execute(
        select(AnalysisTask).filter(AnalysisTask.task_status == AnalysisTaskStatus.IN_PROGRESS)
    )
    return result.scalars().first()

async def update_analysis_task(db: AsyncSession, *, db_obj: AnalysisTask, obj_in: AnalysisTaskUpdate) -> AnalysisTask:
    update_data = obj_in.model_dump(exclude_unset=True)
    for field in update_data:
        setattr(db_obj, field, update_data[field])
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

# RedundancyPolicySet CRUD
async def create_redundancy_policy_sets(db: AsyncSession, *, sets_in: List[RedundancyPolicySetCreate]) -> None:
    db_sets = [RedundancyPolicySet(**s.model_dump()) for s in sets_in]
    db.add_all(db_sets)
    await db.commit()

async def get_redundancy_policy_sets_by_task(db: AsyncSession, task_id: int) -> List[RedundancyPolicySet]:
    result = await db.execute(
        select(RedundancyPolicySet)
        .options(selectinload(RedundancyPolicySet.policy))
        .filter(RedundancyPolicySet.task_id == task_id)
        .order_by(RedundancyPolicySet.set_number, RedundancyPolicySet.type.desc())
    )
    return result.scalars().all()

async def delete_redundancy_policy_sets_by_task(db: AsyncSession, task_id: int) -> None:
    # This is handled by ondelete="CASCADE" in the model, but an explicit function can be useful.
    # For now, we rely on the cascade delete.
    pass

# AnalysisResult CRUD
async def get_analysis_result(db: AsyncSession, result_id: int):
    """특정 ID를 가진 분석 결과를 조회합니다."""
    result = await db.execute(select(AnalysisResult).filter(AnalysisResult.id == result_id))
    return result.scalar_one_or_none()

async def get_analysis_result_by_device_and_type(db: AsyncSession, *, device_id: int, analysis_type: str):
    """특정 장비와 분석 유형에 대한 가장 최근의 분석 결과를 조회합니다."""
    result = await db.execute(
        select(AnalysisResult)
        .filter(AnalysisResult.device_id == device_id, AnalysisResult.analysis_type == analysis_type)
        .order_by(AnalysisResult.created_at.desc())
    )
    return result.scalars().first()

async def create_or_update_analysis_result(db: AsyncSession, *, obj_in: AnalysisResultCreate):
    """분석 결과를 생성하거나 이미 존재하면 업데이트합니다."""
    existing_result = await get_analysis_result_by_device_and_type(
        db, device_id=obj_in.device_id, analysis_type=obj_in.analysis_type
    )

    if existing_result:
        # Update
        update_data = obj_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(existing_result, field, value)
        db_obj = existing_result
    else:
        # Create
        db_obj = AnalysisResult(**obj_in.model_dump())

    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj
