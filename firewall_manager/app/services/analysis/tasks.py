import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, models, schemas
from app.services.analysis.redundancy_analyzer import RedundancyAnalyzer
from app.db.session import SessionLocal
from app.models.analysis import TaskStatus

analysis_lock = asyncio.Semaphore(1)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def run_redundancy_analysis_task(task_id: int):
    """
    백그라운드에서 중복 정책 분석을 수행하는 비동기 태스크입니다.
    """
    async with analysis_lock:
        async with SessionLocal() as db:
            try:
                task = await crud.analysis.analysis_task.get(db, id=task_id)
                if not task:
                    logger.error(f"Task ID {task_id} not found.")
                    return

                device = await crud.device.get_device(db, device_id=task.device_id)
                if not device:
                    logger.error(f"Device ID {task.device_id} for Task ID {task_id} not found.")
                    task.status = TaskStatus.FAILURE
                    task.logs = "Device not found."
                    task.end_time = datetime.now(ZoneInfo("Asia/Seoul"))
                    await db.commit()
                    return

                logger.info(f"Task {task_id} for device '{device.name}' starting analysis.")
                task.status = TaskStatus.IN_PROGRESS
                task.start_time = datetime.now(ZoneInfo("Asia/Seoul"))
                await db.commit()

                analyzer = RedundancyAnalyzer(db)
                analysis_results = await analyzer.analyze(device)

                await crud.analysis.redundancy_policy_set.remove_by_task(db, task_id=task_id)

                if analysis_results:
                    for result in analysis_results:
                        result.task_id = task_id

                    await crud.analysis.redundancy_policy_set.bulk_create(db, objs_in=analysis_results)

                task.status = TaskStatus.SUCCESS
                task.end_time = datetime.now(ZoneInfo("Asia/Seoul"))
                log_message = f"Analysis completed successfully. Found {len(analysis_results)} redundant items."
                task.logs = log_message
                logger.info(log_message)

                await db.commit()

            except Exception as e:
                logger.error(f"Error during redundancy analysis for task {task_id}: {e}", exc_info=True)
                if 'task' in locals() and task:
                    task.status = TaskStatus.FAILURE
                    task.end_time = datetime.now(ZoneInfo("Asia/Seoul"))
                    task.logs = str(e)
                    await db.commit()
            finally:
                logger.info(f"Task {task_id} finished.")

async def start_redundancy_analysis(db: AsyncSession, device_id: int) -> models.AnalysisTask:
    """
    새로운 중복 정책 분석 작업을 시작합니다.
    """
    in_progress_task = await crud.analysis.analysis_task.find_in_progress_task(db, task_type="redundancy")
    if in_progress_task:
        raise ValueError(f"An analysis task (ID: {in_progress_task.id}) is already in progress. Please wait for it to complete.")

    task_in = schemas.AnalysisTaskCreate(
        device_id=device_id,
        task_type="redundancy",
        status=TaskStatus.PENDING
    )
    new_task = await crud.analysis.analysis_task.create(db, obj_in=task_in)

    return new_task
