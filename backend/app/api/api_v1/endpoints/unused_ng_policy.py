# app/api/api_v1/endpoints/unused_ng_policy.py
"""
"미사용 NG 정책" 리포트 파이프라인 실행 전용 엔드포인트.

프로젝트 생성/조회/삭제/메모/이력조회는 공용 endpoints/analysis_projects.py를 그대로
사용한다. 이 파일은 4단계(0~3) 파이프라인의 실행/업로드/다운로드만 담당한다.
"""

import datetime
import os
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.analysis import AnalysisTaskType
from app.models.user import User
from app import crud
from app.crud import crud_analysis_project as apcrud
from app.schemas.analysis import AnalysisTaskCreate
from app.services.unused_ng_policy.tasks import run_pipeline_task

router = APIRouter()


def _kst_now() -> datetime.datetime:
    return datetime.datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)


def _content_disposition(filename: str) -> str:
    """RFC 5987 인코딩으로 Content-Disposition 헤더 값을 반환합니다 (한글 파일명 지원)."""
    ascii_name = filename.encode("ascii", "ignore").decode()
    encoded = quote(filename, safe="")
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded}'


async def _schedule_pipeline_task(
    db: AsyncSession,
    background_tasks: BackgroundTasks,
    project_id: int,
    device_id: int,
    pipeline_task_id: int,
    current_user: User,
) -> int:
    """AnalysisTask(PENDING) 행을 동기적으로 생성하고 백그라운드 실행을 예약합니다."""
    task = await crud.analysis.create_analysis_task(
        db,
        obj_in=AnalysisTaskCreate(
            device_id=device_id,
            task_type=AnalysisTaskType.UNUSED_NG_POLICY,
            pipeline_task_id=pipeline_task_id,
            analysis_project_id=project_id,
            created_at=_kst_now(),
            requested_by_user_id=current_user.id,
            requested_by_username=current_user.username,
        ),
    )
    background_tasks.add_task(
        run_pipeline_task, task.id, project_id, pipeline_task_id,
        current_user.id, current_user.username,
    )
    return task.id


@router.post("/projects/{project_id}/extract")
async def project_extract(
    project_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Task 0: FAT DB에서 정책을 추출합니다 (필터 없음, 전량 추출)."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    running = await crud.analysis.get_running_analysis_task_by_project(db, project_id)
    if running:
        raise HTTPException(
            status_code=409,
            detail=f"이미 {running.requested_by_username}님이 태스크 {running.pipeline_task_id}를 실행 중입니다.",
        )

    analysis_task_id = await _schedule_pipeline_task(
        db, background_tasks, project_id, project.device_id, 0, current_user,
    )
    await db.commit()
    return {"ok": True, "task_id": 0, "analysis_task_id": analysis_task_id}


@router.post("/projects/{project_id}/tasks/{task_id}/upload")
async def upload_external_file(
    project_id: int,
    task_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Task 2: 사용이력(hit_dates) 파일을 업로드합니다 (실행 없음, 단순 저장)."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if task_id != 2:
        raise HTTPException(status_code=400, detail="업로드는 Task 2(사용이력)만 지원합니다.")

    data = await file.read()
    await apcrud.upsert_file(db, project_id=project_id, task_id=task_id, slot="external_0",
                              filename=file.filename, data=data)
    await db.commit()
    return {"ok": True, "filename": file.filename, "task_id": task_id, "slot": "external_0"}


@router.post("/projects/{project_id}/tasks/{task_id}/run")
async def run_project_task(
    project_id: int,
    task_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Task 1(신청번호파싱) 또는 Task 3(통합가공)을 백그라운드로 실행합니다."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if task_id not in (1, 3):
        raise HTTPException(status_code=400, detail=f"유효하지 않은 태스크 번호: {task_id}")

    running = await crud.analysis.get_running_analysis_task_by_project(db, project_id)
    if running:
        raise HTTPException(
            status_code=409,
            detail=f"이미 {running.requested_by_username}님이 태스크 {running.pipeline_task_id}를 실행 중입니다.",
        )

    analysis_task_id = await _schedule_pipeline_task(
        db, background_tasks, project_id, project.device_id, task_id, current_user,
    )
    await db.commit()
    return {"ok": True, "task_id": task_id, "analysis_task_id": analysis_task_id}


@router.get("/projects/{project_id}/tasks/{task_id}/download")
async def download_task_file(
    project_id: int,
    task_id: int,
    slot: str = "output_0",
    db: AsyncSession = Depends(get_db),
):
    """저장된 태스크 파일을 다운로드합니다."""
    f = await apcrud.get_file(db, project_id=project_id, task_id=task_id, slot=slot)
    if not f:
        raise HTTPException(status_code=404, detail=f"파일을 찾을 수 없습니다: task {task_id} / {slot}")

    ext = os.path.splitext(f.filename)[1].lower()
    media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if ext == ".xlsx" else "application/octet-stream"

    return Response(
        content=f.file_data,
        media_type=media,
        headers={"Content-Disposition": _content_disposition(f.filename)},
    )
