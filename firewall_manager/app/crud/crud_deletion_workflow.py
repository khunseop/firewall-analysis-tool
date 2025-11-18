"""
DeletionWorkflow CRUD 작업
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, List

from app.models.deletion_workflow import DeletionWorkflow


async def get_workflow(db: AsyncSession, workflow_id: int) -> Optional[DeletionWorkflow]:
    """워크플로우 조회"""
    result = await db.execute(select(DeletionWorkflow).where(DeletionWorkflow.id == workflow_id))
    return result.scalars().first()


async def get_workflow_by_device(db: AsyncSession, device_id: int) -> Optional[DeletionWorkflow]:
    """장비 ID로 워크플로우 조회"""
    result = await db.execute(
        select(DeletionWorkflow)
        .where(DeletionWorkflow.device_id == device_id)
        .order_by(DeletionWorkflow.created_at.desc())
    )
    return result.scalars().first()


async def create_workflow(db: AsyncSession, device_id: int) -> DeletionWorkflow:
    """새 워크플로우 생성"""
    workflow = DeletionWorkflow(
        device_id=device_id,
        current_step=1,
        status="pending",
        step_files={},
        final_files={}
    )
    db.add(workflow)
    await db.commit()
    await db.refresh(workflow)
    return workflow


async def update_workflow(
    db: AsyncSession,
    workflow: DeletionWorkflow,
    current_step: Optional[int] = None,
    status: Optional[str] = None,
    master_file_path: Optional[str] = None,
    step_files: Optional[dict] = None,
    final_files: Optional[dict] = None
) -> DeletionWorkflow:
    """워크플로우 업데이트"""
    if current_step is not None:
        workflow.current_step = current_step
    if status is not None:
        workflow.status = status
    if master_file_path is not None:
        workflow.master_file_path = master_file_path
    if step_files is not None:
        workflow.step_files = step_files
    if final_files is not None:
        workflow.final_files = final_files
    
    await db.commit()
    await db.refresh(workflow)
    return workflow


async def delete_workflow(db: AsyncSession, workflow: DeletionWorkflow) -> None:
    """워크플로우 삭제"""
    await db.delete(workflow)
    await db.commit()

