from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional

from app.models.analysis import AnalysisTask, RedundancyPolicySet, AnalysisTaskStatus
from app.schemas.analysis import AnalysisTaskCreate, AnalysisTaskUpdate, RedundancyPolicySetCreate

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
        select(RedundancyPolicySet).filter(RedundancyPolicySet.task_id == task_id).order_by(RedundancyPolicySet.set_number, RedundancyPolicySet.type.desc())
    )
    return result.scalars().all()

async def delete_redundancy_policy_sets_by_task(db: AsyncSession, task_id: int) -> None:
    # This is handled by ondelete="CASCADE" in the model, but an explicit function can be useful.
    # For now, we rely on the cascade delete.
    pass
