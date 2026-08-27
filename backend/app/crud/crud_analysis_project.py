import datetime
from typing import Dict, List, Optional, Tuple, Union

from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis import AnalysisTask
from app.models.analysis_project import AnalysisProjectFile, AnalysisProject


async def create_project(
    db: AsyncSession,
    module_type: str,
    device_id: int,
    name: str,
    memo: Optional[str] = None,
    reference_date: Optional[datetime.date] = None,
) -> AnalysisProject:
    now = datetime.datetime.utcnow()
    project = AnalysisProject(
        module_type=module_type,
        device_id=device_id,
        name=name,
        memo=memo,
        reference_date=reference_date,
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
    module_type: str,
    device_id: Optional[int] = None,
) -> List[AnalysisProject]:
    q = select(AnalysisProject).where(AnalysisProject.module_type == module_type).order_by(AnalysisProject.created_at.desc())
    if device_id is not None:
        q = q.where(AnalysisProject.device_id == device_id)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_project(db: AsyncSession, project_id: int) -> Optional[AnalysisProject]:
    result = await db.execute(
        select(AnalysisProject).where(AnalysisProject.id == project_id)
    )
    return result.scalar_one_or_none()


async def delete_project(db: AsyncSession, project_id: int) -> None:
    # SQLite FK 강제가 꺼져 있고 Core delete는 ORM cascade를 타지 않으므로
    # 파일과 연관 AnalysisTask(파이프라인 실행 이력)를 명시적으로 먼저 삭제한다 (고아 행 방지)
    await db.execute(
        delete(AnalysisProjectFile).where(AnalysisProjectFile.project_id == project_id)
    )
    await db.execute(
        delete(AnalysisTask).where(AnalysisTask.analysis_project_id == project_id)
    )
    await db.execute(
        delete(AnalysisProject).where(AnalysisProject.id == project_id)
    )


async def update_project_status(
    db: AsyncSession,
    project: AnalysisProject,
    status: str,
) -> AnalysisProject:
    project.status = status
    project.updated_at = datetime.datetime.utcnow()
    await db.flush()
    return project


_UNSET = object()


async def update_project(
    db: AsyncSession,
    project: AnalysisProject,
    memo=_UNSET,
    reference_date=_UNSET,
) -> AnalysisProject:
    """memo, reference_date 중 전달된 항목만 업데이트합니다. 미전달 시 유지."""
    if memo is not _UNSET:
        project.memo = memo
    if reference_date is not _UNSET:
        project.reference_date = reference_date
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
    analysis_task_id: Optional[int] = None,
) -> AnalysisProjectFile:
    result = await db.execute(
        select(AnalysisProjectFile).where(
            AnalysisProjectFile.project_id == project_id,
            AnalysisProjectFile.task_id == task_id,
            AnalysisProjectFile.slot == slot,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.filename = filename
        existing.file_data = data
        existing.created_at = datetime.datetime.utcnow()
        existing.analysis_task_id = analysis_task_id
        await db.flush()
        return existing
    else:
        f = AnalysisProjectFile(
            project_id=project_id,
            task_id=task_id,
            slot=slot,
            filename=filename,
            file_data=data,
            created_at=datetime.datetime.utcnow(),
            analysis_task_id=analysis_task_id,
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
) -> Optional[AnalysisProjectFile]:
    result = await db.execute(
        select(AnalysisProjectFile).where(
            AnalysisProjectFile.project_id == project_id,
            AnalysisProjectFile.task_id == task_id,
            AnalysisProjectFile.slot == slot,
        )
    )
    return result.scalar_one_or_none()


async def get_project_files(
    db: AsyncSession,
    project_id: int,
) -> Dict[Tuple[int, str], AnalysisProjectFile]:
    result = await db.execute(
        select(AnalysisProjectFile).where(AnalysisProjectFile.project_id == project_id)
    )
    return {(f.task_id, f.slot): f for f in result.scalars().all()}


async def clear_output_files(
    db: AsyncSession,
    project_id: int,
    task_ids: Optional[List[int]] = None,
) -> int:
    """output_* 슬롯 파일 삭제. task_ids 지정 시 해당 태스크만, None이면 전체."""
    cond = and_(
        AnalysisProjectFile.project_id == project_id,
        AnalysisProjectFile.slot.like("output_%"),
    )
    if task_ids is not None:
        cond = and_(cond, AnalysisProjectFile.task_id.in_(task_ids))
    result = await db.execute(delete(AnalysisProjectFile).where(cond))
    return result.rowcount


async def clear_all_files(
    db: AsyncSession,
    project_id: int,
) -> int:
    """프로젝트의 모든 파일 삭제 (output + external)."""
    result = await db.execute(
        delete(AnalysisProjectFile).where(AnalysisProjectFile.project_id == project_id)
    )
    return result.rowcount
