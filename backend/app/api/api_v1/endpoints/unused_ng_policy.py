# app/api/api_v1/endpoints/unused_ng_policy.py
"""
"미사용 NG 정책" 리포트 파이프라인 실행 전용 엔드포인트.

프로젝트 생성/조회/삭제/메모/이력조회는 공용 endpoints/analysis_projects.py를 그대로
사용한다. 이 파일은 단일 태스크(정책추출→신청번호파싱→사용이력 라이브 수집→통합가공)
실행/다운로드만 담당한다.
"""

import datetime
import os
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends
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


@router.post("/projects/{project_id}/run")
async def run_project(
    project_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """단일 태스크로 정책추출→신청번호파싱→사용이력 라이브 수집→통합가공을 실행합니다."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    running = await crud.analysis.get_running_analysis_task_by_project(db, project_id)
    if running:
        raise HTTPException(
            status_code=409,
            detail=f"이미 {running.requested_by_username}님이 실행 중입니다.",
        )

    analysis_task_id = await _schedule_pipeline_task(
        db, background_tasks, project_id, project.device_id, 0, current_user,
    )
    await db.commit()
    return {"ok": True, "task_id": 0, "analysis_task_id": analysis_task_id}


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
