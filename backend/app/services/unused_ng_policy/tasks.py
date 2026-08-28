"""
"미사용 NG 정책" 파이프라인 태스크 실행을 관리하고 실행하는 오케스트레이션 모듈입니다.

services/deletion_workflow/tasks.py와 동일한 패턴(백그라운드 실행 + 프로젝트별
asyncio.Lock + AnalysisTask 상태 추적)을 따르되, 이 모듈은 4단계(0~3)뿐인
선형 파이프라인이라 TaskRegistry/input_resolver 같은 범용 리졸버는 두지 않고
_execute_pipeline_task 안에 단계별 분기를 인라인으로 둔다.

단계 구성:
  0: 정책추출 (DB → Excel, 필터 없음)
  1: 신청번호파싱 (0의 출력 입력, RequestParser 재사용)
  2: 사용이력 업로드 (실행 로직 없음 — 엔드포인트에서 외부 파일 업로드만 처리)
  3: 통합가공 (1의 출력 + 2의 업로드 파일 입력, 사용이력 병합 + 시작일/경과일/AD·NG여부 컬럼)

CPU 바운드 pandas 연산이므로 IO_EXECUTOR가 아닌 CPU_EXECUTOR에서 실행한다
(장비 접속이 없는 순수 연산이기 때문 — deletion_workflow의 WorkspaceRunner와의 차이점).
"""

import asyncio
import io
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.core.executors import CPU_EXECUTOR
from app.crud import crud_analysis_project as apcrud
from app.db.session import SessionLocal
from app.schemas.analysis import AnalysisTaskUpdate
from app.services.audit_log import log_activity
from app.services.deletion_workflow.config_bridge import load_config_dict
from app.services.unused_ng_policy.export_service import ExportDataError, build_policy_export
from app.services.unused_ng_policy.processing import merge_and_enrich, parse_and_add_request_info

logger = logging.getLogger(__name__)


def get_kst_now():
    """한국 시간(KST) 현재 시간 반환"""
    return datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)


# 프로젝트별로 파이프라인 태스크가 동시 실행되지 않도록 보장하는 프로젝트별 비동기 락.
# deletion_workflow의 _project_pipeline_locks와 동일 패턴이지만 별도 딕셔너리로 독립 운용.
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
        logger.info(f"미사용 NG 정책 파이프라인 태스크 실행 시작. Project ID: {project_id}, Task ID: {pipeline_task_id}")

        task = await crud.analysis.update_analysis_task(
            db, db_obj=task,
            obj_in=AnalysisTaskUpdate(started_at=get_kst_now(), task_status='in_progress'),
        )
        await log_activity(
            db, title="미사용 NG 정책 태스크 실행 시작",
            message=f"Project ID {project_id} Task {pipeline_task_id} 실행 시작",
            type="info", category="unused_ng_policy", device_id=task.device_id,
        )

        try:
            saved = await _execute_pipeline_task(db, project_id, pipeline_task_id, analysis_task_id)

            await crud.analysis.update_analysis_task(
                db, db_obj=task,
                obj_in=AnalysisTaskUpdate(completed_at=get_kst_now(), task_status='success'),
            )
            await log_activity(
                db, title="미사용 NG 정책 태스크 실행 완료",
                message=f"Project ID {project_id} Task {pipeline_task_id} 실행 완료 ({len(saved)}개 파일)",
                type="success", category="unused_ng_policy", device_id=task.device_id,
            )
            logger.info(f"미사용 NG 정책 파이프라인 태스크 실행 성공. AnalysisTask ID: {analysis_task_id}")
        except Exception as e:
            logger.exception(f"미사용 NG 정책 파이프라인 태스크 실행 실패. Project ID: {project_id}, Task ID: {pipeline_task_id}: {e}")
            await crud.analysis.update_analysis_task(
                db, db_obj=task,
                obj_in=AnalysisTaskUpdate(
                    completed_at=get_kst_now(), task_status='failure', error_message=str(e),
                ),
            )
            await log_activity(
                db, title="미사용 NG 정책 태스크 실행 실패",
                message=f"Project ID {project_id} Task {pipeline_task_id} 실행 실패: {e}",
                type="error", category="unused_ng_policy", device_id=task.device_id,
            )


def _df_to_xlsx_bytes(df: pd.DataFrame, sheet_name: str = "policy") -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=sheet_name, index=False)
    return buf.getvalue()


async def _execute_pipeline_task(
    db: AsyncSession, project_id: int, pipeline_task_id: int, analysis_task_id: int,
) -> list:
    """실제 태스크 실행 로직. 성공 시 저장된 [{slot, filename}, ...] 목록을 반환하고,
    실패 시 예외를 발생시킨다(호출부에서 AnalysisTask.error_message로 기록).
    """
    project = await apcrud.get_project(db, project_id)
    if not project:
        raise ValueError("프로젝트를 찾을 수 없습니다.")

    device = await crud.device.get_device(db=db, device_id=project.device_id)
    if not device:
        raise ValueError("장비를 찾을 수 없습니다.")

    loop = asyncio.get_event_loop()

    # ── Task 0: 정책 추출 (필터 없음) ──────────────────────────────────────
    if pipeline_task_id == 0:
        try:
            content, filename = await build_policy_export(db, device, reference_date=project.reference_date)
        except ExportDataError as e:
            raise ValueError(str(e))

        await apcrud.upsert_file(
            db, project_id=project_id, task_id=0, slot="output_0",
            filename=filename, data=content, analysis_task_id=analysis_task_id,
        )
        await apcrud.update_project_status(db, project, "running")
        await db.commit()
        return [{"slot": "output_0", "filename": filename}]

    # ── Task 1: 신청번호파싱 (Task 0 출력이 입력) ───────────────────────────
    if pipeline_task_id == 1:
        input_file = await apcrud.get_file(db, project_id=project_id, task_id=0, slot="output_0")
        if not input_file:
            raise ValueError("Task 0(정책추출) 결과가 없습니다. 먼저 정책 추출을 실행하세요.")

        config_dict = await load_config_dict(db)

        def _run():
            df = pd.read_excel(io.BytesIO(input_file.file_data))
            result_df = parse_and_add_request_info(df, config_dict)
            return _df_to_xlsx_bytes(result_df)

        content = await loop.run_in_executor(CPU_EXECUTOR, _run)
        filename = f"신청번호파싱_{input_file.filename}"
        await apcrud.upsert_file(
            db, project_id=project_id, task_id=1, slot="output_0",
            filename=filename, data=content, analysis_task_id=analysis_task_id,
        )
        await db.commit()
        return [{"slot": "output_0", "filename": filename}]

    # ── Task 3: 통합가공 (Task 1 출력 + Task 2 업로드 파일이 입력) ──────────
    if pipeline_task_id == 3:
        request_file = await apcrud.get_file(db, project_id=project_id, task_id=1, slot="output_0")
        if not request_file:
            raise ValueError("Task 1(신청번호파싱) 결과가 없습니다. 먼저 신청번호파싱을 실행하세요.")
        usage_file = await apcrud.get_file(db, project_id=project_id, task_id=2, slot="external_0")
        if not usage_file:
            raise ValueError("Task 2(사용이력) 업로드 파일이 없습니다. 먼저 사용이력 파일을 업로드하세요.")

        def _run():
            policy_df = pd.read_excel(io.BytesIO(request_file.file_data))
            usage_df = pd.read_excel(io.BytesIO(usage_file.file_data))
            result_df = merge_and_enrich(policy_df, usage_df, project.reference_date)
            return _df_to_xlsx_bytes(result_df, sheet_name="미사용NG정책")

        content = await loop.run_in_executor(CPU_EXECUTOR, _run)
        filename = f"미사용NG정책_{request_file.filename}"
        await apcrud.upsert_file(
            db, project_id=project_id, task_id=3, slot="output_0",
            filename=filename, data=content, analysis_task_id=analysis_task_id,
        )
        if project.status == "completed":
            await apcrud.update_project_status(db, project, "running")
        await db.commit()
        return [{"slot": "output_0", "filename": filename}]

    raise ValueError(f"유효하지 않은 태스크 번호: {pipeline_task_id}")
