
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas
from app.db.session import get_db
from app.services.analysis.tasks import (
    run_redundancy_analysis_task,
    run_unused_analysis_task,
    run_impact_analysis_task,
    run_unreferenced_objects_analysis_task,
    run_risky_ports_analysis_task,
    run_over_permissive_analysis_task
)

router = APIRouter()

@router.post("/redundancy/{device_id}", response_model=schemas.Msg)
async def start_redundancy_analysis(
    device_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    지정된 장비에 대한 중복 정책 분석을 시작합니다.
    """
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    running_task = await crud.analysis.get_running_analysis_task(db)
    if running_task:
        raise HTTPException(status_code=409, detail=f"An analysis task (ID: {running_task.id}) is already in progress.")

    background_tasks.add_task(run_redundancy_analysis_task, db, device_id)

    return {"msg": "Redundancy analysis has been started in the background."}

@router.get("/{device_id}/status", response_model=schemas.AnalysisTask)
async def get_analysis_status(
    device_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    지정된 장비의 가장 최근 분석 작업 상태를 조회합니다.
    """
    task = await crud.analysis.get_latest_analysis_task_by_device(db, device_id=device_id)
    if not task:
        raise HTTPException(status_code=404, detail="No analysis task found for this device.")
    return task

@router.get("/redundancy/{task_id}/results", response_model=List[schemas.RedundancyPolicySet])
async def get_redundancy_analysis_results(
    task_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    완료된 중복 정책 분석 작업의 결과를 조회합니다.
    """
    task = await crud.analysis.get_analysis_task(db, task_id=task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Analysis task not found.")

    results = await crud.analysis.get_redundancy_policy_sets_by_task(db, task_id=task_id)
    return results

@router.get("/{device_id}/redundancy/latest-result", response_model=schemas.AnalysisResult)
async def get_latest_redundancy_analysis_result(
    device_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    지정된 장비의 가장 최근 중복 정책 분석 결과를 조회합니다.
    """
    result = await crud.analysis.get_analysis_result_by_device_and_type(
        db, device_id=device_id, analysis_type="redundancy"
    )
    if not result:
        raise HTTPException(status_code=404, detail="Redundancy analysis result not found.")
    return result

@router.get("/{device_id}/latest-result", response_model=schemas.AnalysisResult)
async def read_latest_analysis_result(
    device_id: int,
    analysis_type: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    특정 장비와 분석 유형에 대한 가장 최근의 분석 결과를 가져옵니다.
    """
    result = await crud.analysis.get_analysis_result_by_device_and_type(
        db, device_id=device_id, analysis_type=analysis_type
    )
    if not result:
        raise HTTPException(
            status_code=404,
            detail="해당 장비와 분석 유형에 대한 분석 결과가 없습니다.",
        )
    return result

@router.get("/tasks", response_model=schemas.AnalysisTaskListResponse)
async def list_analysis_tasks(
    device_id: Optional[int] = None,
    analysis_type: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    분석 실행 이력을 게시판 형태로 조회합니다 (장비명 검색, 유형/상태 필터, 페이지네이션 지원).
    """
    tasks, total = await crud.analysis.list_analysis_tasks_paginated(
        db, device_id=device_id, task_type=analysis_type, task_status=status,
        search=search, page=page, page_size=page_size,
    )
    items = [
        schemas.AnalysisTaskListItem(
            id=t.id,
            device_id=t.device_id,
            device_name=t.device.name if t.device else str(t.device_id),
            device_ip=t.device.ip_address if t.device else "",
            task_type=t.task_type,
            task_status=t.task_status,
            created_at=t.created_at,
            started_at=t.started_at,
            completed_at=t.completed_at,
            error_message=t.error_message,
        )
        for t in tasks
    ]
    return schemas.AnalysisTaskListResponse(items=items, total=total)

@router.get("/tasks/{task_id}", response_model=schemas.AnalysisTask)
async def get_analysis_task_detail(
    task_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    게시판 목록에서 선택한 특정 분석 실행(task)의 상태를 조회합니다.
    """
    task = await crud.analysis.get_analysis_task(db, task_id=task_id)
    if not task:
        raise HTTPException(status_code=404, detail="분석 작업을 찾을 수 없습니다.")
    return task

@router.get("/tasks/{task_id}/result", response_model=schemas.AnalysisResult)
async def get_analysis_task_result(
    task_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    특정 분석 실행(task)에 연결된 결과 데이터를 조회합니다.
    """
    result = await crud.analysis.get_analysis_result_by_task_id(db, task_id=task_id)
    if not result:
        raise HTTPException(status_code=404, detail="해당 작업에 대한 분석 결과가 없습니다.")
    return result

@router.post("/unused/{device_id}", response_model=schemas.Msg)
async def start_unused_analysis(
    device_id: int,
    days: int = 90,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    지정된 장비에 대한 미사용 정책 분석을 시작합니다.
    """
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    running_task = await crud.analysis.get_running_analysis_task(db)
    if running_task:
        raise HTTPException(status_code=409, detail=f"An analysis task (ID: {running_task.id}) is already in progress.")

    background_tasks.add_task(run_unused_analysis_task, db, device_id, days)

    return {"msg": f"Unused policy analysis has been started in the background (기준: {days}일)."}

@router.post("/impact/{device_id}", response_model=schemas.Msg)
async def start_impact_analysis(
    device_id: int,
    target_policy_id: List[int] = Query(..., description="분석할 대상 정책 ID 목록"),
    reference_policy_id: Optional[int] = Query(None, description="이동 기준 정책 ID (미입력 시 맨 아래로 이동)"),
    move_direction: Optional[str] = Query(None, description="이동 방향 (above/below)"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    정책 위치 이동 시정책이동 영향분석을 시작합니다.
    여러 정책을 동시에 분석할 수 있습니다.
    """
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if not target_policy_id or len(target_policy_id) == 0:
        raise HTTPException(status_code=400, detail="At least one target policy ID is required")

    running_task = await crud.analysis.get_running_analysis_task(db)
    if running_task:
        raise HTTPException(status_code=409, detail=f"An analysis task (ID: {running_task.id}) is already in progress.")

    background_tasks.add_task(run_impact_analysis_task, db, device_id, target_policy_id, reference_policy_id, move_direction)

    return {"msg": f"Impact analysis has been started in the background for {len(target_policy_id)} policy(ies)."}

@router.post("/unreferenced-objects/{device_id}", response_model=schemas.Msg)
async def start_unreferenced_objects_analysis(
    device_id: int,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    지정된 장비에 대한 미참조 객체 분석을 시작합니다.
    """
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    running_task = await crud.analysis.get_running_analysis_task(db)
    if running_task:
        raise HTTPException(status_code=409, detail=f"An analysis task (ID: {running_task.id}) is already in progress.")

    background_tasks.add_task(run_unreferenced_objects_analysis_task, db, device_id)

    return {"msg": "Unreferenced objects analysis has been started in the background."}

@router.post("/risky-ports/{device_id}", response_model=schemas.Msg)
async def start_risky_ports_analysis(
    device_id: int,
    target_policy_id: Optional[List[int]] = Query(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    지정된 장비에 대한 위험 포트 정책 분석을 시작합니다.
    target_policy_id가 제공되면 해당 정책들만 분석하고, 없으면 모든 정책을 분석합니다.
    """
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    running_task = await crud.analysis.get_running_analysis_task(db)
    if running_task:
        raise HTTPException(status_code=409, detail=f"An analysis task (ID: {running_task.id}) is already in progress.")

    background_tasks.add_task(run_risky_ports_analysis_task, db, device_id, target_policy_id)

    return {"msg": "Risky ports analysis has been started in the background."}

@router.post("/over-permissive/{device_id}", response_model=schemas.Msg)
async def start_over_permissive_analysis(
    device_id: int,
    target_policy_id: Optional[List[int]] = Query(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    지정된 장비에 대한 과허용정책 분석을 시작합니다.
    target_policy_id가 제공되면 해당 정책들만 분석하고, 없으면 모든 정책을 분석합니다.
    """
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    running_task = await crud.analysis.get_running_analysis_task(db)
    if running_task:
        raise HTTPException(status_code=409, detail=f"An analysis task (ID: {running_task.id}) is already in progress.")

    background_tasks.add_task(run_over_permissive_analysis_task, db, device_id, target_policy_id)

    return {"msg": "Over-permissive policy analysis has been started in the background."}
