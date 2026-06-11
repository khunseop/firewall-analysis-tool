import datetime
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deletion_workflow import DeletionWorkflowFile, DeletionWorkflowProject


async def create_project(
    db: AsyncSession,
    device_id: int,
    name: str,
    memo: Optional[str] = None,
) -> DeletionWorkflowProject:
    now = datetime.datetime.utcnow()
    project = DeletionWorkflowProject(
        device_id=device_id,
        name=name,
        memo=memo,
        status="draft",
        created_at=now,
        updated_at=now,
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


async def list_projects(
    db: AsyncSession,
    device_id: Optional[int] = None,
) -> List[DeletionWorkflowProject]:
    q = select(DeletionWorkflowProject).order_by(DeletionWorkflowProject.created_at.desc())
    if device_id is not None:
        q = q.where(DeletionWorkflowProject.device_id == device_id)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_project(db: AsyncSession, project_id: int) -> Optional[DeletionWorkflowProject]:
    result = await db.execute(
        select(DeletionWorkflowProject).where(DeletionWorkflowProject.id == project_id)
    )
    return result.scalar_one_or_none()


async def delete_project(db: AsyncSession, project_id: int) -> None:
    await db.execute(
        delete(DeletionWorkflowProject).where(DeletionWorkflowProject.id == project_id)
    )


async def update_project_status(
    db: AsyncSession,
    project: DeletionWorkflowProject,
    status: str,
) -> DeletionWorkflowProject:
    project.status = status
    project.updated_at = datetime.datetime.utcnow()
    await db.flush()
    return project


async def upsert_file(
    db: AsyncSession,
    project_id: int,
    task_id: int,
    slot: str,
    filename: str,
    data: bytes,
) -> DeletionWorkflowFile:
    result = await db.execute(
        select(DeletionWorkflowFile).where(
            DeletionWorkflowFile.project_id == project_id,
            DeletionWorkflowFile.task_id == task_id,
            DeletionWorkflowFile.slot == slot,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.filename = filename
        existing.file_data = data
        existing.created_at = datetime.datetime.utcnow()
        await db.flush()
        return existing
    else:
        f = DeletionWorkflowFile(
            project_id=project_id,
            task_id=task_id,
            slot=slot,
            filename=filename,
            file_data=data,
            created_at=datetime.datetime.utcnow(),
        )
        db.add(f)
        await db.flush()
        await db.refresh(f)
        return f


async def get_file(
    db: AsyncSession,
    project_id: int,
    task_id: int,
    slot: str,
) -> Optional[DeletionWorkflowFile]:
    result = await db.execute(
        select(DeletionWorkflowFile).where(
            DeletionWorkflowFile.project_id == project_id,
            DeletionWorkflowFile.task_id == task_id,
            DeletionWorkflowFile.slot == slot,
        )
    )
    return result.scalar_one_or_none()


async def get_project_files(
    db: AsyncSession,
    project_id: int,
) -> Dict[Tuple[int, str], DeletionWorkflowFile]:
    result = await db.execute(
        select(DeletionWorkflowFile).where(DeletionWorkflowFile.project_id == project_id)
    )
    return {(f.task_id, f.slot): f for f in result.scalars().all()}
