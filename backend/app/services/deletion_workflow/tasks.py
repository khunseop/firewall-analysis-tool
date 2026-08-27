"""
정책 삭제 워크플로우 파이프라인 태스크 실행을 관리하고 실행하는 오케스트레이션 모듈입니다.

app/services/analysis/tasks.py 의 패턴(백그라운드 실행 + AnalysisTask 상태 추적)을
그대로 따른다. 각 파이프라인 단계(task_id 0~19) 실행 1회가 AnalysisTask
(task_type=DELETION_WORKFLOW) 1행에 대응하며, 산출된 파일은 기존과 동일하게
AnalysisProjectFile에 저장하되 analysis_task_id로 실행을 참조한다.

analysis 6종과 달리 AnalysisTask(PENDING) 생성은 API 엔드포인트에서 동기적으로
수행한다 — 프론트가 백그라운드 스케줄 직후 즉시 analysis_task_id를 받아 폴링을
시작해야 하기 때문이다. 이 모듈은 이미 생성된 PENDING 행을 이어받아 진행한다.
"""

import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.core.executors import IO_EXECUTOR
from app.crud import crud_analysis_project as dwcrud
from app.db.session import SessionLocal
from app.schemas.analysis import AnalysisTaskUpdate
from app.services.audit_log import log_activity
from app.services.deletion_workflow.core.input_resolver import (
    MissingInputError,
    get_downstream_tasks,
    get_vendor_task_id,
    resolve_inputs,
)
from app.services.deletion_workflow.core.workspace_runner import WorkspaceRunner
from app.services.deletion_workflow.config_bridge import (
    load_config_dict,
    save_task15_exceptions_to_settings,
)
from app.services.deletion_workflow.export_service import (
    ExportDataError,
    build_device_export,
    build_redundancy_export,
)
from app.services.deletion_workflow.task_meta import TASK_META

logger = logging.getLogger(__name__)


def get_kst_now():
    """한국 시간(KST) 현재 시간 반환"""
    return datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)


# 프로젝트별로 파이프라인 태스크가 동시 실행되지 않도록 보장하는 프로젝트별 비동기 락.
# analysis/tasks.py의 _device_analysis_locks와 동일한 패턴이지만, 별도 딕셔너리로
# device 단위 분석 락과는 공유하지 않는다.
_project_pipeline_locks: dict[int, asyncio.Lock] = {}


def _get_project_lock(project_id: int) -> asyncio.Lock:
    return _project_pipeline_locks.setdefault(project_id, asyncio.Lock())


async def run_pipeline_task(
    analysis_task_id: int,
    project_id: int,
    pipeline_task_id: int,
    requested_by_user_id: Optional[int] = None,
    requested_by_username: Optional[str] = None,
):
    """파이프라인 태스크 실행 백그라운드 진입점.

    요청 스코프 세션은 응답 후 닫히므로 여기서 자체 세션을 연다.
    """
    async with SessionLocal() as db:
        await _run_pipeline_task(
            db, analysis_task_id, project_id, pipeline_task_id,
            requested_by_user_id, requested_by_username,
        )


async def _run_pipeline_task(
    db: AsyncSession,
    analysis_task_id: int,
    project_id: int,
    pipeline_task_id: int,
    requested_by_user_id: Optional[int] = None,
    requested_by_username: Optional[str] = None,
):
    """
    삭제 워크플로우 파이프라인의 단일 태스크(task_id 0~19)를 실행합니다.

    1. 프로젝트 락을 획득합니다(엔드포인트의 DB 조회 기반 사전 체크에 이은 2차 방어선).
    2. 이미 생성된 AnalysisTask(PENDING)를 'in_progress'로 변경합니다.
    3. Task 0/3은 DB→Excel 변환, 그 외 태스크는 WorkspaceRunner로 레거시 프로세서를 실행합니다.
    4. 산출 파일을 AnalysisProjectFile로 저장(analysis_task_id 연결)하고 하위 태스크의
       stale output을 정리합니다.
    5. AnalysisTask 상태를 'success' 또는 'failure'로 업데이트합니다.
    """
    task = await crud.analysis.get_analysis_task(db, analysis_task_id)
    if not task:
        logger.error(f"AnalysisTask {analysis_task_id}를 찾을 수 없습니다.")
        return

    project_lock = _get_project_lock(project_id)
    if project_lock.locked():
        logger.warning(f"프로젝트 {project_id}에서 이미 다른 태스크가 실행 중입니다.")
        await crud.analysis.update_analysis_task(
            db, db_obj=task,
            obj_in=AnalysisTaskUpdate(
                task_status='failure',
                completed_at=get_kst_now(),
                error_message="이미 다른 태스크가 실행 중입니다. 잠시 후 다시 시도하세요.",
            ),
        )
        return

    async with project_lock:
        logger.info(f"파이프라인 태스크 실행 시작. Project ID: {project_id}, Task ID: {pipeline_task_id}")

        task = await crud.analysis.update_analysis_task(
            db, db_obj=task,
            obj_in=AnalysisTaskUpdate(started_at=get_kst_now(), task_status='in_progress'),
        )
        await log_activity(
            db, title="삭제 워크플로우 태스크 실행 시작",
            message=f"Project ID {project_id} Task {pipeline_task_id} 실행 시작",
            type="info", category="deletion_workflow", device_id=task.device_id,
        )

        try:
            saved = await _execute_pipeline_task(db, project_id, pipeline_task_id, analysis_task_id)

            await crud.analysis.update_analysis_task(
                db, db_obj=task,
                obj_in=AnalysisTaskUpdate(completed_at=get_kst_now(), task_status='success'),
            )
            await log_activity(
                db, title="삭제 워크플로우 태스크 실행 완료",
                message=f"Project ID {project_id} Task {pipeline_task_id} 실행 완료 ({len(saved)}개 파일)",
                type="success", category="deletion_workflow", device_id=task.device_id,
            )
            logger.info(f"파이프라인 태스크 실행 성공. AnalysisTask ID: {analysis_task_id}")
        except Exception as e:
            logger.exception(f"파이프라인 태스크 실행 실패. Project ID: {project_id}, Task ID: {pipeline_task_id}: {e}")
            await crud.analysis.update_analysis_task(
                db, db_obj=task,
                obj_in=AnalysisTaskUpdate(
                    completed_at=get_kst_now(), task_status='failure', error_message=str(e),
                ),
            )
            await log_activity(
                db, title="삭제 워크플로우 태스크 실행 실패",
                message=f"Project ID {project_id} Task {pipeline_task_id} 실행 실패: {e}",
                type="error", category="deletion_workflow", device_id=task.device_id,
            )


async def _execute_pipeline_task(
    db: AsyncSession, project_id: int, pipeline_task_id: int, analysis_task_id: int,
) -> list:
    """실제 태스크 실행 로직. 성공 시 저장된 [{slot, filename}, ...] 목록을 반환하고,
    실패 시 예외를 발생시킨다(호출부에서 AnalysisTask.error_message로 기록).
    """
    project = await dwcrud.get_project(db, project_id)
    if not project:
        raise ValueError("프로젝트를 찾을 수 없습니다.")

    device = await crud.device.get_device(db=db, device_id=project.device_id)
    if not device:
        raise ValueError("장비를 찾을 수 없습니다.")
    vendor = device.vendor if device else ""

    # ── Task 0: FAT DB → Excel 추출 ────────────────────────────────────────
    if pipeline_task_id == 0:
        try:
            content, filename = await build_device_export(db, device, reference_date=project.reference_date)
        except ExportDataError as e:
            raise ValueError(str(e))

        await dwcrud.upsert_file(
            db, project_id=project_id, task_id=0, slot="output_0",
            filename=filename, data=content, analysis_task_id=analysis_task_id,
        )
        await dwcrud.update_project_status(db, project, "running")
        await db.commit()
        return [{"slot": "output_0", "filename": filename}]

    # ── Task 3: FAT DB 중복분석 결과 → Excel 변환 ──────────────────────────
    if pipeline_task_id == 3:
        try:
            content, filename = await build_redundancy_export(
                db, project.device_id, device, reference_date=project.reference_date)
        except ExportDataError as e:
            raise ValueError(str(e))

        await dwcrud.upsert_file(
            db, project_id=project_id, task_id=3, slot="output_0",
            filename=filename, data=content, analysis_task_id=analysis_task_id,
        )
        downstream = get_downstream_tasks(3)
        if downstream:
            await dwcrud.clear_output_files(db, project_id, task_ids=downstream)
        if project.status == "completed":
            await dwcrud.update_project_status(db, project, "running")
        await db.commit()
        return [{"slot": "output_0", "filename": filename}]

    # ── 그 외: 레거시 CLI 프로세서 실행 ─────────────────────────────────────
    if pipeline_task_id not in TASK_META:
        raise ValueError(f"유효하지 않은 태스크 번호: {pipeline_task_id}")

    # Task 10/11 자동 선택: 벤더에 따라 실제 실행할 task_id 결정
    effective_task_id = pipeline_task_id
    if pipeline_task_id in (10, 11):
        effective_task_id = get_vendor_task_id(vendor)

    files_map = await dwcrud.get_project_files(db, project_id)

    try:
        input_files = resolve_inputs(effective_task_id, files_map, vendor)
    except MissingInputError as e:
        raise ValueError(str(e))

    contents = [data for data, _ in input_files]
    filenames = [name for _, name in input_files]

    extra_kwargs = {}
    if effective_task_id == 10:
        extra_kwargs["vendor"] = "paloalto"
    elif effective_task_id == 11:
        extra_kwargs["vendor"] = "secui"
    elif effective_task_id == 17:
        extra_kwargs["device_id"] = project.device_id
    if effective_task_id in (14, 18, 19):
        extra_kwargs["project_name"] = project.name

    loop = asyncio.get_event_loop()
    config_dict = await load_config_dict(db)
    runner = WorkspaceRunner(config_dict=config_dict, reference_date=project.reference_date)

    try:
        output_files = await loop.run_in_executor(
            IO_EXECUTOR,
            lambda: runner.run_task(effective_task_id, contents, filenames, **extra_kwargs)
        )
    except (ValueError, RuntimeError) as e:
        raise ValueError(str(e))
    except Exception as e:
        logger.exception(f"Project {project_id} Task {effective_task_id} 실행 오류: {e}")
        raise ValueError(f"태스크 실행 실패: {str(e)}")

    if not output_files:
        raise ValueError("태스크 실행 완료됐으나 출력 파일이 없습니다.")

    # Task 15 완료 시 미사용예외를 Settings duplicate_policies에 누적 저장
    if effective_task_id == 15:
        unused_threshold_days = config_dict.get("analysis_criteria", {}).get("unused_threshold_days", 90)
        await save_task15_exceptions_to_settings(
            db, project.device_id, output_files,
            reference_date=project.reference_date,
            unused_threshold_days=unused_threshold_days,
        )

    # 출력 파일을 프로젝트에 저장 (output_0, output_1, ...) — .yaml은 제외
    saved = []
    for idx, (fname, data) in enumerate(
        [(f, d) for f, d in output_files if not f.endswith('.yaml')]
    ):
        slot = f"output_{idx}"
        await dwcrud.upsert_file(
            db, project_id=project_id, task_id=effective_task_id,
            slot=slot, filename=fname, data=data, analysis_task_id=analysis_task_id,
        )
        saved.append({"slot": slot, "filename": fname})

    # 재실행으로 이 태스크의 출력이 갱신되었으므로, 이를 입력으로 삼던
    # 하위 태스크들의 기존 output은 stale해진다. 남겨두면 이후 하위 태스크가
    # 최신이 아닌 과거 결과를 그대로 사용하게 되므로 함께 삭제해 재실행을 강제한다.
    downstream = get_downstream_tasks(effective_task_id)
    if downstream:
        await dwcrud.clear_output_files(db, project_id, task_ids=downstream)

    # 완료된 프로젝트에서 중간 태스크를 재실행하면 결과가 갱신되므로
    # 완료 상태를 해제해 다시 완료 처리(결과 저장)할 수 있게 한다.
    if project.status == "completed":
        await dwcrud.update_project_status(db, project, "running")

    await db.commit()
    return saved
