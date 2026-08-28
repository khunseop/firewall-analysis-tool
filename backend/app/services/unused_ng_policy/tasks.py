"""
"미사용 NG 정책" 파이프라인 태스크 실행을 관리하고 실행하는 오케스트레이션 모듈입니다.

services/deletion_workflow/tasks.py와 동일한 패턴(백그라운드 실행 + 프로젝트별
asyncio.Lock + AnalysisTask 상태 추적)을 따르되, 이 모듈은 단일 태스크(0)로
정책추출→신청번호파싱→사용이력 라이브 수집→통합가공을 한 번에 실행하는
선형 파이프라인이라 TaskRegistry/input_resolver 같은 범용 리졸버는 두지 않고
_execute_pipeline_task 안에 전체 흐름을 인라인으로 둔다.

단계 구성 (전부 태스크 0 하나로 실행):
  1. 정책추출 (DB → DataFrame, 필터 없음)
  2. 신청번호파싱 (RequestParser 재사용)
  3. 사용이력 라이브 수집 (장비 접속 — Devices 페이지 "직접 추출"과 동일한 벤더
     컬렉터 사용, HA Peer 병합 포함). 벤더가 값을 못 채우면(NGF 등) '-'로 표시.
  4. 통합가공 (사용이력 병합 + 시작일/경과일/AD·NG여부 컬럼)

1~2, 4는 CPU 바운드라 CPU_EXECUTOR, 3은 장비 I/O라 IO_EXECUTOR에서 실행한다.
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
from app.core.executors import CPU_EXECUTOR, IO_EXECUTOR
from app.crud import crud_analysis_project as apcrud
from app.db.session import SessionLocal
from app.schemas.analysis import AnalysisTaskUpdate
from app.services.audit_log import log_activity
from app.services.deletion_workflow.config_bridge import load_config_dict
from app.services.sync.collector import create_collector_from_device
from app.services.unused_ng_policy.export_service import ExportDataError, build_policy_export
from app.services.unused_ng_policy.processing import merge_and_enrich, parse_and_add_request_info

logger = logging.getLogger(__name__)

# 사용이력 라이브 수집 타임아웃(초). Devices 페이지 "직접 추출" 다이얼로그의 기본값과 동일.
_USAGE_COLLECT_TIMEOUT = 600


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
        logger.info(f"미사용 NG 정책 파이프라인 실행 시작. Project ID: {project_id}")

        task = await crud.analysis.update_analysis_task(
            db, db_obj=task,
            obj_in=AnalysisTaskUpdate(started_at=get_kst_now(), task_status='in_progress'),
        )
        await log_activity(
            db, title="미사용 NG 정책 태스크 실행 시작",
            message=f"Project ID {project_id} 실행 시작",
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
                message=f"Project ID {project_id} 실행 완료 ({len(saved)}개 파일)",
                type="success", category="unused_ng_policy", device_id=task.device_id,
            )
            logger.info(f"미사용 NG 정책 파이프라인 실행 성공. AnalysisTask ID: {analysis_task_id}")
        except Exception as e:
            logger.exception(f"미사용 NG 정책 파이프라인 실행 실패. Project ID: {project_id}: {e}")
            await crud.analysis.update_analysis_task(
                db, db_obj=task,
                obj_in=AnalysisTaskUpdate(
                    completed_at=get_kst_now(), task_status='failure', error_message=str(e),
                ),
            )
            await log_activity(
                db, title="미사용 NG 정책 태스크 실행 실패",
                message=f"Project ID {project_id} 실행 실패: {e}",
                type="error", category="unused_ng_policy", device_id=task.device_id,
            )


def _df_to_xlsx_bytes(df: pd.DataFrame, sheet_name: str = "policy") -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=sheet_name, index=False)
    return buf.getvalue()


async def _collect_usage_live(device, loop: asyncio.AbstractEventLoop) -> pd.DataFrame:
    """장비에 라이브 접속해 사용이력(hit_count/first_hit_date/last_hit_date/unused_days)을
    수집한다. Devices 페이지 "직접 추출"(hit_dates)과 동일한 벤더 컬렉터를 사용하되,
    파이프라인 실행 로직은 모듈 간 공통화하지 않는다는 원칙에 따라 이 모듈 전용으로
    독립 작성한다. HA Peer가 있으면 last_hit_date 기준 최신값으로 병합한다.

    벤더가 해당 기능을 지원하지 않으면(NGF 등) 빈 DataFrame이 반환될 수 있다 —
    이 경우 이후 merge_and_enrich 단계에서 '-'로 채워진다.
    """
    use_ssh = bool(device.use_ssh_for_last_hit_date)

    collector = create_collector_from_device(device)

    def _method():
        return collector.export_last_hit_date_ssh(timeout=_USAGE_COLLECT_TIMEOUT) if use_ssh else collector.export_last_hit_date()

    await loop.run_in_executor(IO_EXECUTOR, collector.connect)
    try:
        main_df = await asyncio.wait_for(
            loop.run_in_executor(IO_EXECUTOR, _method), timeout=_USAGE_COLLECT_TIMEOUT
        )
    finally:
        try:
            await loop.run_in_executor(IO_EXECUTOR, collector.disconnect)
        except Exception:
            pass

    if not device.ha_peer_ip:
        return main_df

    ha_collector = create_collector_from_device(device, use_ha_ip=True)
    ha_df: pd.DataFrame | None = None
    try:
        await loop.run_in_executor(IO_EXECUTOR, ha_collector.connect)

        def _ha_method():
            return ha_collector.export_last_hit_date_ssh(timeout=_USAGE_COLLECT_TIMEOUT) if use_ssh else ha_collector.export_last_hit_date()

        ha_df = await asyncio.wait_for(
            loop.run_in_executor(IO_EXECUTOR, _ha_method), timeout=_USAGE_COLLECT_TIMEOUT
        )
    except Exception as e:
        logger.warning(f"HA peer 사용이력 수집 실패 ({device.ha_peer_ip}): {e}")
    finally:
        try:
            await loop.run_in_executor(IO_EXECUTOR, ha_collector.disconnect)
        except Exception:
            pass

    if ha_df is None or ha_df.empty:
        return main_df

    combined = pd.concat([main_df, ha_df])
    if "last_hit_date" in combined.columns:
        combined["last_hit_date"] = pd.to_datetime(combined["last_hit_date"], errors="coerce")
        subset = ["vsys", "rule_name"] if "vsys" in combined.columns else ["rule_name"]
        combined = combined.sort_values("last_hit_date", ascending=False, na_position="last")
        combined = combined.drop_duplicates(subset=subset, keep="first")
    return combined


async def _execute_pipeline_task(
    db: AsyncSession, project_id: int, pipeline_task_id: int, analysis_task_id: int,
) -> list:
    """실제 태스크 실행 로직. 성공 시 저장된 [{slot, filename}, ...] 목록을 반환하고,
    실패 시 예외를 발생시킨다(호출부에서 AnalysisTask.error_message로 기록).
    """
    if pipeline_task_id != 0:
        raise ValueError(f"유효하지 않은 태스크 번호: {pipeline_task_id}")

    project = await apcrud.get_project(db, project_id)
    if not project:
        raise ValueError("프로젝트를 찾을 수 없습니다.")

    device = await crud.device.get_device(db=db, device_id=project.device_id)
    if not device:
        raise ValueError("장비를 찾을 수 없습니다.")

    loop = asyncio.get_event_loop()

    # 1) 정책 추출 (DB, 필터 없음)
    try:
        policy_content, filename = await build_policy_export(db, device, reference_date=project.reference_date)
    except ExportDataError as e:
        raise ValueError(str(e))

    config_dict = await load_config_dict(db)

    def _parse_step():
        df = pd.read_excel(io.BytesIO(policy_content))
        return parse_and_add_request_info(df, config_dict)

    # 2) 신청번호파싱 (CPU)
    parsed_df = await loop.run_in_executor(CPU_EXECUTOR, _parse_step)

    # 3) 사용이력 라이브 수집 (장비 I/O)
    usage_df = await _collect_usage_live(device, loop)

    # 4) 통합가공 (CPU)
    def _merge_step():
        result_df = merge_and_enrich(parsed_df, usage_df, project.reference_date)
        return _df_to_xlsx_bytes(result_df, sheet_name="미사용NG정책")

    content = await loop.run_in_executor(CPU_EXECUTOR, _merge_step)
    out_filename = f"미사용NG정책_{filename}"

    await apcrud.upsert_file(
        db, project_id=project_id, task_id=0, slot="output_0",
        filename=out_filename, data=content, analysis_task_id=analysis_task_id,
    )
    await apcrud.update_project_status(db, project, "running")
    await db.commit()
    return [{"slot": "output_0", "filename": out_filename}]
