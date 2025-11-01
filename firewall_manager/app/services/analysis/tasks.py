import asyncio
import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.schemas.analysis import AnalysisTaskCreate, AnalysisTaskUpdate
from app.models.analysis import AnalysisTaskType
from .redundancy import RedundancyAnalyzer

logger = logging.getLogger(__name__)

# 분석 작업이 동시에 실행되지 않도록 보장하기 위한 잠금
analysis_lock = asyncio.Lock()

async def run_redundancy_analysis_task(db: AsyncSession, device_id: int):
    """
    특정 장비에 대한 중복 정책 분석을 실행하고 관리합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        # 필요하다면 여기에 사용자에게 알림을 보내는 로직을 추가할 수 있습니다.
        return

    async with analysis_lock:
        logger.info(f"분석 작업 시작. Device ID: {device_id}")

        # 1. 새 분석 작업 생성
        task_create = AnalysisTaskCreate(
            device_id=device_id,
            task_type=AnalysisTaskType.REDUNDANCY,
            created_at=datetime.now()
        )
        task = await crud.analysis.create_analysis_task(db, obj_in=task_create)

        try:
            # 2. 작업 상태를 'in_progress'로 업데이트
            task_update = AnalysisTaskUpdate(
                started_at=datetime.now(),
                task_status='in_progress'
            )
            task = await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)

            # 3. 핵심 분석 로직 실행
            analyzer = RedundancyAnalyzer(db_session=db, task=task)
            await analyzer.analyze()

            # 4. 작업 상태를 'success'로 업데이트
            task_update = AnalysisTaskUpdate(
                completed_at=datetime.now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"분석 작업 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"분석 작업 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            # 5. 작업 상태를 'failure'로 업데이트
            task_update = AnalysisTaskUpdate(
                completed_at=datetime.now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
