
"""
보안 정책 및 객체 분석 작업을 관리하고 실행하는 오케스트레이션 모듈입니다.

각 분석 유형별로 독립된 비동기 작업(Task)을 생성하고, 실제 분석 엔진을 호출한 뒤 
그 결과를 DB의 analysis_results 테이블에 JSON 형식으로 저장하며 작업 상태를 업데이트합니다.
"""

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

# 분석 작업이 중복 실행되지 않도록 보장하는 비동기 락
analysis_lock = asyncio.Lock()

async def run_redundancy_analysis_task(db: AsyncSession, device_id: int):
    """
    중복 정책 분석 작업을 실행합니다.
    
    1. 분석 작업을 생성(Pending)하고 락을 획득합니다.
    2. 상태를 'in_progress'로 변경합니다.
    3. RedundancyAnalyzer를 호출하여 중복 세트를 식별합니다.
    4. 분석 결과를 JSON으로 직렬화하여 analysis_results 테이블에 저장합니다.
    5. 작업 상태를 'success' 또는 'failure'로 업데이트합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        logger.info(f"중복 정책 분석 시작. Device ID: {device_id}")

        # [단계 1] 분석 작업 레코드 생성
        task_create = AnalysisTaskCreate(
            device_id=device_id,
            task_type=AnalysisTaskType.REDUNDANCY,
            created_at=get_kst_now()
        )
        task = await crud.analysis.create_analysis_task(db, obj_in=task_create)

        # [단계 2] 상태를 'in_progress'로 업데이트
        task_update = AnalysisTaskUpdate(
            started_at=get_kst_now(),
            task_status='in_progress'
        )
        task = await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)

        try:
            # [단계 3] 실제 분석 로직 실행
            analyzer = RedundancyAnalyzer(db_session=db, task=task)
            analysis_sets = await analyzer.analyze()

            # [단계 4] 결과 저장
            if analysis_sets:
                # 중간 단계 테이블(redundancypolicysets)에 상세 데이터 저장
                await crud.analysis.create_redundancy_policy_sets(db, sets_in=analysis_sets)
                
                # 최종 결과물 통합 조회를 위해 다시 로드 후 JSON 직렬화
                final_results_with_policy = await crud.analysis.get_redundancy_policy_sets_by_task(db, task_id=task.id)
                result_data_json = jsonable_encoder(final_results_with_policy)

                # analysis_results 테이블에 영구 저장 (기존 결과 있을 경우 업데이트)
                result_to_store = AnalysisResultCreate(
                    device_id=device_id,
                    analysis_type=AnalysisTaskType.REDUNDANCY.value,
                    result_data=result_data_json
                )
                await crud.analysis.create_or_update_analysis_result(db, obj_in=result_to_store)

            # [단계 5] 성공 상태로 종료
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"중복 정책 분석 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"중복 정책 분석 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            # 실패 상태로 업데이트
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)


async def run_unused_analysis_task(db: AsyncSession, device_id: int, days: int = 90):
    """
    미사용 정책 분석 작업을 실행합니다.
    장기간(기본 90일) 동안 트래픽 매칭이 발생하지 않은 정책을 찾아냅니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        logger.info(f"미사용 정책 분석 시작. Device ID: {device_id}, 기준일: {days}일")

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
            # 분석 엔진 실행
            analyzer = UnusedPolicyAnalyzer(db_session=db, task=task, days=days)
            results = await analyzer.analyze()

            if results:
                # 결과를 JSON으로 변환하여 저장
                result_data_json = jsonable_encoder(results)

                result_to_store = AnalysisResultCreate(
                    device_id=device_id,
                    analysis_type=AnalysisTaskType.UNUSED.value,
                    result_data=result_data_json
                )
                await crud.analysis.create_or_update_analysis_result(db, obj_in=result_to_store)

            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"미사용 정책 분석 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"미사용 정책 분석 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)


async def run_impact_analysis_task(db: AsyncSession, device_id: int, target_policy_ids: List[int], new_position: int, move_direction: Optional[str] = None):
    """
    정책 위치 이동 시 영향도 분석 작업을 실행합니다.
    이동 경로상에 있는 정책들과의 충돌 또는 가림(Shadowing) 현상을 미리 확인합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        if isinstance(target_policy_ids, int):
            target_policy_ids = [target_policy_ids]
        
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
            # 영향 분석 엔진 실행
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

            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"정책이동 영향 분석 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"정책이동 영향 분석 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='failure'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)


async def run_unreferenced_objects_analysis_task(db: AsyncSession, device_id: int):
    """
    미참조 객체 분석 작업을 실행합니다.
    어떤 정책에서도 사용되지 않는 고립된 네트워크/서비스 객체를 탐지합니다.
    """
    if analysis_lock.locked():
        logger.warning(f"분석 작업이 이미 진행 중입니다. Device ID: {device_id}")
        return

    async with analysis_lock:
        logger.info(f"미참조 객체 분석 시작. Device ID: {device_id}")

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
            # 미참조 객체 분석 엔진 실행
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

            task_update = AnalysisTaskUpdate(
                completed_at=get_kst_now(),
                task_status='success'
            )
            await crud.analysis.update_analysis_task(db, db_obj=task, obj_in=task_update)
            logger.info(f"미참조 객체 분석 성공. Task ID: {task.id}")

        except Exception as e:
            logger.error(f"미참조 객체 분석 실패. Task ID: {task.id}, Error: {e}", exc_info=True)
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
