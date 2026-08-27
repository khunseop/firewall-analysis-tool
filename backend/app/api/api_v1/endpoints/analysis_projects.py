# app/api/api_v1/endpoints/analysis_projects.py
"""
프로젝트형 분석 모듈(예: deletion_workflow)의 공용 프로젝트 CRUD 엔드포인트.

"프로젝트가 무엇인가"(생성/조회/삭제/메모/기준일 수정, 실행 이력)만 다루며,
"프로젝트 안에서 무엇을 실행하는가"(파이프라인 단계 실행)는 모듈별 전용
엔드포인트(예: /deletion-workflow/projects/{id}/run)에 남아있다.
"""

import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Form, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app import crud
from app.crud import crud_analysis_project as apcrud

router = APIRouter()


def _validate_module_type(module_type: str) -> None:
    """프로젝트형 모듈로 등록되지 않은 module_type을 거부한다."""
    if module_type not in crud.analysis.PROJECT_MODULE_TASK_TYPES:
        raise HTTPException(status_code=400, detail=f"알 수 없는 모듈 타입: {module_type}")


def _project_dict(project, device) -> dict:
    return {
        "id": project.id,
        "module_type": project.module_type,
        "device_id": project.device_id,
        "device_name": device.name if device else str(project.device_id),
        "device_ip": device.ip_address if device else "",
        "name": project.name,
        "status": project.status,
        "memo": project.memo,
        "reference_date": project.reference_date.isoformat() if project.reference_date else None,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }


@router.get("")
async def list_projects(
    module_type: str,
    device_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    """모듈 타입별 프로젝트 목록 조회."""
    _validate_module_type(module_type)
    projects = await apcrud.list_projects(db, module_type=module_type, device_id=device_id)
    result = []
    for p in projects:
        device = await crud.device.get_device(db=db, device_id=p.device_id)
        result.append(_project_dict(p, device))
    return result


@router.post("")
async def create_project(
    module_type: str = Form(...),
    device_id: int = Form(...),
    name: str = Form(...),
    memo: str = Form(default=""),
    reference_date: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
):
    """새 프로젝트 생성."""
    _validate_module_type(module_type)
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"장비 ID {device_id}를 찾을 수 없습니다.")

    parsed_ref_date = None
    if reference_date:
        try:
            parsed_ref_date = datetime.date.fromisoformat(reference_date)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"잘못된 날짜 형식: {reference_date} (YYYY-MM-DD 형식 사용)")

    project = await apcrud.create_project(
        db, module_type=module_type, device_id=device_id, name=name,
        memo=memo or None, reference_date=parsed_ref_date,
    )
    await db.commit()
    return _project_dict(project, device)


@router.get("/{project_id}")
async def get_project(project_id: int, db: AsyncSession = Depends(get_db)):
    """프로젝트 상세 조회 (파일 상태 포함)."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    device = await crud.device.get_device(db=db, device_id=project.device_id)
    files_map = await apcrud.get_project_files(db, project_id)

    file_states = [
        {
            "task_id": k[0],
            "slot": k[1],
            "filename": f.filename,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for k, f in sorted(files_map.items())
    ]

    data = _project_dict(project, device)
    data["device_vendor"] = device.vendor if device else ""
    data["files"] = file_states
    return data


@router.delete("/{project_id}")
async def delete_project(project_id: int, db: AsyncSession = Depends(get_db)):
    """프로젝트 삭제 (파일 + 연관 AnalysisTask 실행 이력 cascade)."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    await apcrud.delete_project(db, project_id)
    await db.commit()
    return {"ok": True}


@router.patch("/{project_id}")
async def update_project(
    project_id: int,
    memo: Optional[str] = Form(default=None),
    reference_date: Optional[str] = Form(default=None),
    clear_reference_date: bool = Form(default=False),
    db: AsyncSession = Depends(get_db),
):
    """프로젝트 메모 또는 기준일을 수정합니다."""
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    kwargs = {}
    if memo is not None:
        kwargs["memo"] = memo
    if clear_reference_date:
        kwargs["reference_date"] = None
    elif reference_date is not None:
        try:
            kwargs["reference_date"] = datetime.date.fromisoformat(reference_date)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"잘못된 날짜 형식: {reference_date} (YYYY-MM-DD 형식 사용)")

    await apcrud.update_project(db, project, **kwargs)
    await db.commit()
    return {
        "id": project.id,
        "memo": project.memo,
        "reference_date": project.reference_date.isoformat() if project.reference_date else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }


@router.get("/{project_id}/tasks")
async def list_project_pipeline_tasks(project_id: int, db: AsyncSession = Depends(get_db)):
    """프로젝트에 속한 파이프라인 태스크(AnalysisTask) 실행 이력을 조회합니다."""
    tasks, total = await crud.analysis.list_analysis_tasks_paginated(
        db, analysis_project_id=project_id, page=1, page_size=1000,
    )
    return {
        "total": total,
        "items": [
            {
                "id": t.id,
                "pipeline_task_id": t.pipeline_task_id,
                "task_status": t.task_status,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "started_at": t.started_at.isoformat() if t.started_at else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                "error_message": t.error_message,
                "requested_by_username": t.requested_by_username,
            }
            for t in tasks
        ],
    }


@router.get("/{project_id}/tasks/{analysis_task_id}/result")
async def get_pipeline_task_result(
    project_id: int, analysis_task_id: int, db: AsyncSession = Depends(get_db),
):
    """특정 파이프라인 실행(analysis_task_id)이 저장한 출력 파일 목록을 반환합니다."""
    task = await crud.analysis.get_analysis_task(db, analysis_task_id)
    if not task or task.analysis_project_id != project_id:
        raise HTTPException(status_code=404, detail="해당 프로젝트의 실행을 찾을 수 없습니다.")

    files_map = await apcrud.get_project_files(db, project_id)
    outputs = [
        {"slot": k[1], "filename": f.filename}
        for k, f in sorted(files_map.items())
        if f.analysis_task_id == analysis_task_id
    ]
    return {
        "task_id": task.pipeline_task_id,
        "task_status": task.task_status,
        "error_message": task.error_message,
        "outputs": outputs,
    }
