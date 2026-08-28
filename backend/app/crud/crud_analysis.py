
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import selectinload
from typing import List, Optional, Tuple

from app.models.analysis import AnalysisTask, RedundancyPolicySet, AnalysisTaskStatus, AnalysisResult
from app.models.device import Device
from app.schemas.analysis import (
    AnalysisTaskCreate, AnalysisTaskUpdate, RedundancyPolicySetCreate,
    AnalysisResultCreate
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

async def get_running_analysis_task(db: AsyncSession, device_id: Optional[int] = None) -> Optional[AnalysisTask]:
    stmt = select(AnalysisTask).filter(AnalysisTask.task_status == AnalysisTaskStatus.IN_PROGRESS)
    if device_id is not None:
        stmt = stmt.filter(AnalysisTask.device_id == device_id)
    result = await db.execute(stmt)
    return result.scalars().first()

async def get_running_analysis_task_by_project(db: AsyncSession, project_id: int) -> Optional[AnalysisTask]:
    """특정 analysis_project에서 진행 중인(IN_PROGRESS) 파이프라인 태스크를 조회합니다."""
    stmt = select(AnalysisTask).filter(
        AnalysisTask.task_status == AnalysisTaskStatus.IN_PROGRESS,
        AnalysisTask.analysis_project_id == project_id,
    )
    result = await db.execute(stmt)
    return result.scalars().first()

async def update_analysis_task(db: AsyncSession, *, db_obj: AnalysisTask, obj_in: AnalysisTaskUpdate) -> AnalysisTask:
    update_data = obj_in.model_dump(exclude_unset=True)
    for field in update_data:
        setattr(db_obj, field, update_data[field])
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def delete_analysis_task(db: AsyncSession, *, db_obj: AnalysisTask) -> None:
    """
    분석 작업과 연관된 결과를 삭제합니다.
    SQLite는 기본적으로 FK 제약(ondelete="CASCADE")을 강제하지 않으므로
    (PRAGMA foreign_keys가 꺼져 있음) 연관 레코드를 명시적으로 먼저 삭제한다.
    """
    await db.execute(delete(AnalysisResult).where(AnalysisResult.task_id == db_obj.id))
    await db.execute(delete(RedundancyPolicySet).where(RedundancyPolicySet.task_id == db_obj.id))
    await db.delete(db_obj)
    await db.commit()

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
    """
    새로운 분석 결과를 생성합니다.
    실행마다 새 행으로 쌓여 이력이 보존되며(task_id로 실행을 구분), 과거처럼 동일한
    장비+분석유형의 이전 결과를 덮어쓰지 않습니다.
    """
    db_obj = AnalysisResult(**obj_in.model_dump())
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def get_analysis_result_by_task_id(db: AsyncSession, *, task_id: int) -> Optional[AnalysisResult]:
    """특정 분석 실행(task)에 연결된 결과를 조회합니다."""
    result = await db.execute(select(AnalysisResult).filter(AnalysisResult.task_id == task_id))
    return result.scalars().first()

# 프로젝트형 분석 모듈(예: deletion_workflow)의 task_type 목록.
# list_analysis_tasks_paginated()가 명시적 타입 필터 없이 조회될 때(퀵 분석 이력 목록)
# 이 타입들의 실행 행(파이프라인 단계별로 여러 개 쌓임)을 자동으로 제외한다 —
# 이들은 프로젝트 단위로 별도 조회(analysis_projects 엔드포인트)된다.
PROJECT_MODULE_TASK_TYPES = {"deletion_workflow", "unused_ng_policy"}


async def list_analysis_tasks_paginated(
    db: AsyncSession, *,
    device_id: Optional[int] = None,
    task_type: Optional[str] = None,
    task_status: Optional[str] = None,
    search: Optional[str] = None,
    analysis_project_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[AnalysisTask], int]:
    """분석 실행(task) 이력을 게시판 형태로 검색·페이지네이션 조회합니다.

    task_type이 명시되지 않고 analysis_project_id도 없으면(=퀵 분석 이력 목록 조회)
    PROJECT_MODULE_TASK_TYPES에 속한 실행은 자동으로 제외한다.
    """
    stmt = select(AnalysisTask).options(selectinload(AnalysisTask.device))
    count_stmt = select(func.count()).select_from(AnalysisTask)

    if search:
        stmt = stmt.join(Device, AnalysisTask.device_id == Device.id)
        count_stmt = count_stmt.join(Device, AnalysisTask.device_id == Device.id)

    conditions = []
    if device_id is not None:
        conditions.append(AnalysisTask.device_id == device_id)
    if task_type:
        conditions.append(AnalysisTask.task_type == task_type)
    elif analysis_project_id is None:
        conditions.append(AnalysisTask.task_type.notin_(PROJECT_MODULE_TASK_TYPES))
    if task_status:
        conditions.append(AnalysisTask.task_status == task_status)
    if analysis_project_id is not None:
        conditions.append(AnalysisTask.analysis_project_id == analysis_project_id)
    if search:
        conditions.append(Device.name.ilike(f"%{search}%"))

    if conditions:
        stmt = stmt.where(*conditions)
        count_stmt = count_stmt.where(*conditions)

    total = (await db.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(AnalysisTask.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    tasks = (await db.execute(stmt)).scalars().all()

    return tasks, total
