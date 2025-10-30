from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional

from app.models.analysis import AnalysisTask, RedundancyPolicySet, TaskStatus
from app.schemas.analysis import AnalysisTaskCreate, RedundancyPolicySetCreate

class CRUDAnalysisTask:
    async def get(self, db: AsyncSession, id: int) -> Optional[AnalysisTask]:
        result = await db.execute(select(AnalysisTask).filter(AnalysisTask.id == id))
        return result.scalars().first()

    async def create(self, db: AsyncSession, *, obj_in: AnalysisTaskCreate) -> AnalysisTask:
        db_obj = AnalysisTask(**obj_in.model_dump())
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    async def get_by_device(self, db: AsyncSession, *, device_id: int) -> List[AnalysisTask]:
        result = await db.execute(select(AnalysisTask).filter(AnalysisTask.device_id == device_id))
        return result.scalars().all()

    async def get_latest_task_for_device(self, db: AsyncSession, *, device_id: int, task_type: str) -> Optional[AnalysisTask]:
        result = await db.execute(
            select(AnalysisTask)
            .filter(AnalysisTask.device_id == device_id, AnalysisTask.task_type == task_type)
            .order_by(AnalysisTask.id.desc())
        )
        return result.scalars().first()

    async def find_in_progress_task(self, db: AsyncSession, *, task_type: str) -> Optional[AnalysisTask]:
        result = await db.execute(
            select(AnalysisTask).filter(AnalysisTask.task_type == task_type, AnalysisTask.status == TaskStatus.IN_PROGRESS)
        )
        return result.scalars().first()

class CRUDRedundancyPolicySet:
    async def get_by_task(self, db: AsyncSession, *, task_id: int) -> List[RedundancyPolicySet]:
        result = await db.execute(select(RedundancyPolicySet).filter(RedundancyPolicySet.task_id == task_id))
        return result.scalars().all()

    async def bulk_create(self, db: AsyncSession, *, objs_in: List[RedundancyPolicySetCreate]):
        db_objs = [RedundancyPolicySet(**obj.model_dump()) for obj in objs_in]
        db.add_all(db_objs)
        # Commit is handled by the service layer

    async def remove_by_task(self, db: AsyncSession, *, task_id: int):
        result = await db.execute(select(RedundancyPolicySet).filter(RedundancyPolicySet.task_id == task_id))
        for obj in result.scalars().all():
            await db.delete(obj)
        # Commit is handled by the service layer

analysis_task = CRUDAnalysisTask()
redundancy_policy_set = CRUDRedundancyPolicySet()
