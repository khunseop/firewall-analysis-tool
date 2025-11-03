
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas
from app.db.session import get_db
from app.services.analysis.tasks import run_redundancy_analysis_task

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
