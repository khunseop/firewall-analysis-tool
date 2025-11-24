
import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Optional
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

def get_kst_now():
    """한국 시간(KST) 현재 시간 반환"""
    return datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)

from app import crud
from app.schemas.analysis import AnalysisTaskCreate, AnalysisTaskUpdate, AnalysisResultCreate
from app.models.analysis import AnalysisTaskType
from .redundancy import RedundancyAnalyzer
from .unused import UnusedPolicyAnalyzer
from .impact import ImpactAnalyzer
from .unreferenced_objects import UnreferencedObjectsAnalyzer
from .risky_ports import RiskyPortsAnalyzer
from .over_permissive import OverPermissiveAnalyzer

logger = logging.getLogger(__name__)

analysis_lock = asyncio.Lock()

async def run_redundancy_analysis_task(db: AsyncSession, device_id: int):
    """
    특정 장비에 대한 중복 정책 분석을 실행하고, 임시 및 영구 결과를 저장합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        logger.info(f"분석 작업 시작. Device ID: {device_id}")

        task_create = AnalysisTaskCreate(
            device_id=device_id,
            task_type=AnalysisTaskType.REDUNDANCY,
            created_at=get_kst_now()
        )
        task = await crud.analysis.create_analysis_task(db, obj_in=task_create)

        # 상태를 'in_progress'로 먼저 업데이트
        task_update = AnalysisTaskUpdate(
            started_at=get_kst_now(),
            task_status='in_progress'
        )
        task = await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)

        try:
            # 1. 핵심 분석 로직 실행 및 결과 반환
            analyzer = RedundancyAnalyzer(db_session=db, task=task)
            analysis_sets = await analyzer.analyze()

            # 2. 임시 결과(redundancypolicysets) 저장
            if analysis_sets:
                await crud.analysis.create_redundancy_policy_sets(db, sets_in=analysis_sets)
                logger.info(f"Task ID {task.id}에 대한 임시 분석 결과 {len(analysis_sets)}개를 저장했습니다.")

                # 3. 영구 결과(analysis_results) 저장 또는 업데이트
                # 결과를 JSON으로 직렬화하기 위해 policy 객체를 포함하여 다시 조회
                final_results_with_policy = await crud.analysis.get_redundancy_policy_sets_by_task(db, task_id=task.id)
                result_data_json = jsonable_encoder(final_results_with_policy)

                result_to_store = AnalysisResultCreate(
                    device_id=device_id,
                    analysis_type=AnalysisTaskType.REDUNDANCY.value,
                    result_data=result_data_json
                )
                await crud.analysis.create_or_update_analysis_result(db, obj_in=result_to_store)
                logger.info(f"Device ID {device_id}에 대한 영구 분석 결과를 저장했습니다.")

            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"분석 작업 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"분석 작업 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)


async def run_unused_analysis_task(db: AsyncSession, device_id: int, days: int = 90):
    """
    특정 장비에 대한 미사용 정책 분석을 실행하고 결과를 저장합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        logger.info(f"미사용 정책 분석 작업 시작. Device ID: {device_id}, 기준일: {days}일")

        task_create = AnalysisTaskCreate(
            device_id=device_id,
            task_type=AnalysisTaskType.UNUSED,
            created_at=get_kst_now()
        )
        task = await crud.analysis.create_analysis_task(db, obj_in=task_create)

        task_update = AnalysisTaskUpdate(
            started_at=get_kst_now(),
            task_status='in_progress'
        )
        task = await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)

        try:
            analyzer = UnusedPolicyAnalyzer(db_session=db, task=task, days=days)
            results = await analyzer.analyze()

            if results:
                # Policy 객체를 JSON으로 직렬화하기 위해 각 결과의 policy를 포함
                result_data_json = jsonable_encoder(results)

                result_to_store = AnalysisResultCreate(
                    device_id=device_id,
                    analysis_type=AnalysisTaskType.UNUSED.value,
                    result_data=result_data_json
                )
                await crud.analysis.create_or_update_analysis_result(db, obj_in=result_to_store)
                logger.info(f"Device ID {device_id}에 대한 미사용 정책 분석 결과를 저장했습니다.")

            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"미사용 정책 분석 작업 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"미사용 정책 분석 작업 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)


async def run_impact_analysis_task(db: AsyncSession, device_id: int, target_policy_ids: List[int], new_position: int, move_direction: Optional[str] = None):
    """
    정책 위치 이동 시 정책이동 영향분석을 실행하고 결과를 저장합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        # 하위 호환을 위해 단일 정책 ID도 리스트로 변환
        if isinstance(target_policy_ids, int):
            target_policy_ids = [target_policy_ids]
        logger.info(f"정책이동 영향분석 작업 시작. Device ID: {device_id}, 정책 ID: {target_policy_ids}, 새 위치: {new_position}, 이동 방향: {move_direction}")
        logger.info(f"ImpactAnalyzer 초기화: move_direction={move_direction}")

        task_create = AnalysisTaskCreate(
            device_id=device_id,
            task_type=AnalysisTaskType.IMPACT,
            created_at=get_kst_now()
        )
        task = await crud.analysis.create_analysis_task(db, obj_in=task_create)

        task_update = AnalysisTaskUpdate(
            started_at=get_kst_now(),
            task_status='in_progress'
        )
        task = await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)

        try:
            analyzer = ImpactAnalyzer(
                db_session=db,
                task=task,
                target_policy_ids=target_policy_ids,
                new_position=new_position,
                move_direction=move_direction
            )
            result = await analyzer.analyze()

            if result:
                result_data_json = jsonable_encoder(result)

                result_to_store = AnalysisResultCreate(
                    device_id=device_id,
                    analysis_type=AnalysisTaskType.IMPACT.value,
                    result_data=result_data_json
                )
                await crud.analysis.create_or_update_analysis_result(db, obj_in=result_to_store)
                logger.info(f"Device ID {device_id}에 대한 정책이동 영향분석 결과를 저장했습니다.")

            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"정책이동영향분석 작업 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"정책이동영향분석 작업 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)


async def run_unreferenced_objects_analysis_task(db: AsyncSession, device_id: int):
    """
    미참조 객체 분석을 실행하고 결과를 저장합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        logger.info(f"미참조 객체 분석 작업 시작. Device ID: {device_id}")

        task_create = AnalysisTaskCreate(
            device_id=device_id,
            task_type=AnalysisTaskType.UNREFERENCED_OBJECTS,
            created_at=get_kst_now()
        )
        task = await crud.analysis.create_analysis_task(db, obj_in=task_create)

        task_update = AnalysisTaskUpdate(
            started_at=get_kst_now(),
            task_status='in_progress'
        )
        task = await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)

        try:
            analyzer = UnreferencedObjectsAnalyzer(db_session=db, task=task)
            results = await analyzer.analyze()

            if results:
                result_data_json = jsonable_encoder(results)

                result_to_store = AnalysisResultCreate(
                    device_id=device_id,
                    analysis_type=AnalysisTaskType.UNREFERENCED_OBJECTS.value,
                    result_data=result_data_json
                )
                await crud.analysis.create_or_update_analysis_result(db, obj_in=result_to_store)
                logger.info(f"Device ID {device_id}에 대한 미참조 객체 분석 결과를 저장했습니다.")

            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"미참조 객체 분석 작업 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"미참조 객체 분석 작업 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)


async def run_risky_ports_analysis_task(db: AsyncSession, device_id: int, target_policy_ids: Optional[List[int]] = None):
    """
    위험 포트 정책 분석을 실행하고 결과를 저장합니다.
    target_policy_ids가 제공되면 해당 정책들만 분석하고, 없으면 모든 정책을 분석합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        logger.info(f"위험 포트 정책 분석 작업 시작. Device ID: {device_id}, Target Policy IDs: {target_policy_ids}")

        task_create = AnalysisTaskCreate(
            device_id=device_id,
            task_type=AnalysisTaskType.RISKY_PORTS,
            created_at=get_kst_now()
        )
        task = await crud.analysis.create_analysis_task(db, obj_in=task_create)

        task_update = AnalysisTaskUpdate(
            started_at=get_kst_now(),
            task_status='in_progress'
        )
        task = await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)

        try:
            analyzer = RiskyPortsAnalyzer(db_session=db, task=task, target_policy_ids=target_policy_ids)
            results = await analyzer.analyze()

            if results:
                result_data_json = jsonable_encoder(results)

                result_to_store = AnalysisResultCreate(
                    device_id=device_id,
                    analysis_type=AnalysisTaskType.RISKY_PORTS.value,
                    result_data=result_data_json
                )
                await crud.analysis.create_or_update_analysis_result(db, obj_in=result_to_store)
                logger.info(f"Device ID {device_id}에 대한 위험 포트 정책 분석 결과를 저장했습니다.")

            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"위험 포트 정책 분석 작업 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"위험 포트 정책 분석 작업 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)


async def run_over_permissive_analysis_task(db: AsyncSession, device_id: int, target_policy_ids: Optional[List[int]] = None):
    """
    과허용정책 분석을 실행하고 결과를 저장합니다.
    target_policy_ids가 제공되면 해당 정책들만 분석하고, 없으면 모든 정책을 분석합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        logger.info(f"과허용정책 분석 작업 시작. Device ID: {device_id}, Target Policy IDs: {target_policy_ids}")

        task_create = AnalysisTaskCreate(
            device_id=device_id,
            task_type=AnalysisTaskType.OVER_PERMISSIVE,
            created_at=get_kst_now()
        )
        task = await crud.analysis.create_analysis_task(db, obj_in=task_create)

        task_update = AnalysisTaskUpdate(
            started_at=get_kst_now(),
            task_status='in_progress'
        )
        task = await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)

        try:
            analyzer = OverPermissiveAnalyzer(db_session=db, task=task, target_policy_ids=target_policy_ids)
            results = await analyzer.analyze()

            if results:
                result_data_json = jsonable_encoder(results)

                result_to_store = AnalysisResultCreate(
                    device_id=device_id,
                    analysis_type=AnalysisTaskType.OVER_PERMISSIVE.value,
                    result_data=result_data_json
                )
                await crud.analysis.create_or_update_analysis_result(db, obj_in=result_to_store)
                logger.info(f"Device ID {device_id}에 대한 과허용정책 분석 결과를 저장했습니다.")

            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"과허용정책 분석 작업 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"과허용정책 분석 작업 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
