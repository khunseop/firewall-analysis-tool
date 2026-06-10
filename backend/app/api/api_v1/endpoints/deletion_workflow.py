# app/api/api_v1/endpoints/deletion_workflow.py
"""
정책 삭제 워크플로우 API 엔드포인트.

fpat policy_deletion_processor의 14개 태스크를 REST API로 노출합니다.
각 태스크는 Excel/CSV 파일을 업로드 받아 처리 결과를 ZIP으로 반환합니다.
"""

import os
import io
import logging
import zipfile
import datetime
from typing import List, Tuple

import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app import crud
from app.models.analysis import AnalysisTaskType, AnalysisTaskStatus
from app.services.deletion_workflow.core.workspace_runner import WorkspaceRunner
from app.services.sync.collector import create_collector_from_device

# fpat 호환 컬럼 매핑 (FAT snake_case → fpat Title Case)
_POLICY_COL_MAP = {
    "vsys": "Vsys",
    "seq": "Seq",
    "rule_name": "Rule Name",
    "enable": "Enable",
    "action": "Action",
    "source": "Source",
    "user": "User",
    "destination": "Destination",
    "service": "Service",
    "application": "Application",
    "security_profile": "Security Profile",
    "category": "Category",
    "description": "Description",
}
_USAGE_COL_MAP = {
    "vsys": "Vsys",
    "rule_name": "Rule Name",
    "last_hit_date": "Last Hit Date",
}

logger = logging.getLogger(__name__)
router = APIRouter()

# fpat.yaml 경로 (프로젝트 루트 기준)
_FPAT_YAML = os.path.join(
    os.path.dirname(__file__),          # endpoints/
    '..', '..', '..', '..', '..',       # → backend root
    'fpat', 'fpat.yaml'
)
_FPAT_YAML = os.path.abspath(_FPAT_YAML)

# 태스크별 메타데이터
TASK_META = {
    1:  {"name": "신청정보파싱",       "input_count": 1, "description": "정책 Excel에서 신청 정보 파싱"},
    2:  {"name": "RequestID추출",      "input_count": 1, "description": "고유 신청 ID 추출"},
    3:  {"name": "MISID업데이트",      "input_count": 2, "description": "정책 Excel + MIS CSV → MIS ID 추가"},
    4:  {"name": "신청정보취합",       "input_count": 1, "description": "외부 시스템 신청 정보 취합"},
    5:  {"name": "신청정보매핑",       "input_count": 2, "description": "정책 Excel + 정보 Excel → 매핑"},
    6:  {"name": "예외처리_PaloAlto",  "input_count": 1, "description": "PaloAlto 정책 예외 분류"},
    7:  {"name": "예외처리_SECUI",     "input_count": 1, "description": "SECUI 정책 예외 분류"},
    8:  {"name": "중복정책분류",       "input_count": 2, "description": "중복정책 Excel + 신청정보 Excel → 분류"},
    9:  {"name": "중복정책상태업데이트","input_count": 2, "description": "정책 Excel + 분류결과 Excel → 중복여부 반영"},
    10: {"name": "히트카운트병합",     "input_count": 2, "description": "HA Primary + Secondary 히트카운트 병합"},
    11: {"name": "미사용여부추가",     "input_count": 2, "description": "정책 Excel + 미사용 Excel → 미사용여부 추가"},
    12: {"name": "미사용예외업데이트", "input_count": 2, "description": "정책 Excel + 중복분류 Excel → 미사용예외 반영"},
    13: {"name": "공지파일분류",       "input_count": 1, "description": "정책 Excel → 유형별 공지파일 생성"},
    14: {"name": "자동연장탐지",       "input_count": 1, "description": "신청정보 Excel → 자동연장 정책 탐지"},
}


def _fpat_yaml_path() -> str:
    """fpat.yaml 경로를 반환합니다. 없으면 빈 문자열 반환."""
    return _FPAT_YAML if os.path.exists(_FPAT_YAML) else ""


def _make_zip_response(output_files: List[Tuple[str, bytes]], zip_name: str) -> StreamingResponse:
    """여러 (filename, bytes) 튜플을 ZIP으로 묶어 StreamingResponse를 반환합니다."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, content in output_files:
            zf.writestr(name, content)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type='application/zip',
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@router.get("/tasks")
async def list_tasks():
    """사용 가능한 태스크 목록과 각 태스크의 설명을 반환합니다."""
    return {
        "tasks": [
            {"id": tid, **meta}
            for tid, meta in TASK_META.items()
        ],
        "fpat_yaml": _fpat_yaml_path() or "설정 파일 없음 — fpat/fpat.yaml 확인 필요",
    }


@router.post("/tasks/{task_id}/execute")
async def execute_task(
    task_id: int,
    files: List[UploadFile] = File(...),
    vendor: str = Form(default=""),
):
    """
    지정된 태스크를 실행합니다.

    - **task_id**: 1-14 사이의 태스크 번호
    - **files**: 입력 파일 목록 (태스크별 필요 파일 수 확인)
    - **vendor**: Tasks 6/7용 — 'paloalto' 또는 'secui' (기본값: 레지스트리 기본값 사용)

    반환: 단일 파일이면 xlsx 다운로드, 복수 파일이면 ZIP 다운로드
    """
    if task_id not in TASK_META:
        raise HTTPException(status_code=400, detail=f"유효하지 않은 태스크 번호: {task_id} (1-14)")

    meta = TASK_META[task_id]
    required = meta["input_count"]

    if len(files) < required:
        raise HTTPException(
            status_code=400,
            detail=f"Task {task_id}({meta['name']})는 파일 {required}개가 필요합니다. (받은 파일: {len(files)}개)"
        )

    # 파일 내용 읽기
    contents = []
    filenames = []
    for f in files[:required]:
        contents.append(await f.read())
        filenames.append(f.filename)

    # 추가 kwargs 구성
    extra_kwargs = {}
    if vendor:
        extra_kwargs["vendor"] = vendor

    # 동기 프로세서를 스레드에서 실행
    import asyncio
    loop = asyncio.get_event_loop()

    runner = WorkspaceRunner(config_path=_fpat_yaml_path() or None)
    try:
        output_files = await loop.run_in_executor(
            None,
            lambda: runner.run_task(task_id, contents, filenames, **extra_kwargs)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception(f"Task {task_id} 실행 중 예외: {e}")
        raise HTTPException(status_code=500, detail=f"Task {task_id} 실행 실패: {str(e)}")

    if not output_files:
        raise HTTPException(
            status_code=500,
            detail=f"Task {task_id} 실행 완료됐으나 출력 파일이 없습니다."
        )

    task_name = meta["name"]

    if len(output_files) == 1:
        # 단일 파일: xlsx 직접 반환
        name, content = output_files[0]
        ext = os.path.splitext(name)[1]
        media = (
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            if ext == '.xlsx' else 'application/octet-stream'
        )
        return Response(
            content=content,
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    # 복수 파일: ZIP 반환
    return _make_zip_response(output_files, f"task{task_id}_{task_name}.zip")


def _df_to_xlsx_bytes(sheets: dict) -> bytes:
    """sheets = {sheet_name: DataFrame} → in-memory xlsx bytes"""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        for sheet_name, df in sheets.items():
            if df is not None and not df.empty:
                df.to_excel(writer, sheet_name=sheet_name, index=False)
    return buf.getvalue()


def _add_unused_days(df: pd.DataFrame) -> pd.DataFrame:
    """Last Hit Date 컬럼에서 Unused Days 계산하여 추가."""
    today = datetime.date.today()
    def _calc(val):
        if pd.isna(val) or val is None:
            return None
        try:
            d = pd.to_datetime(val).date()
            return (today - d).days
        except Exception:
            return None
    df = df.copy()
    df["Unused Days"] = df["Last Hit Date"].apply(_calc)
    return df


@router.post("/extract")
async def extract_device_data(
    device_id: int = Form(...),
    use_ha_peer: bool = Form(default=False),
    use_ssh: bool = Form(default=False),
    db: AsyncSession = Depends(get_db),
):
    """
    등록된 FAT 장비에서 직접 데이터를 추출하여 fpat 호환 Excel을 반환합니다.

    - **device_id**: FAT에 등록된 장비 ID
    - **use_ha_peer**: HA Secondary IP로 연결 (사용이력 추출용)
    - **use_ssh**: PaloAlto에서 SSH 방식으로 사용이력 수집

    반환: policy, address, address_group, service, service_group, usage 시트가 포함된 xlsx
    """
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"장비 ID {device_id}를 찾을 수 없습니다.")

    import asyncio
    loop = asyncio.get_event_loop()

    def _collect():
        collector = create_collector_from_device(device, use_ha_ip=use_ha_peer)
        if not collector.connect():
            raise RuntimeError(f"장비 연결 실패: {device.name} ({device.ip_address})")

        sheets = {}

        # 보안 정책 (컬럼 매핑 적용)
        policy_df = collector.export_security_rules()
        if not policy_df.empty:
            policy_df = policy_df.rename(columns=_POLICY_COL_MAP)
            sheets["policy"] = policy_df

        # 주소 객체
        try:
            addr_df = collector.export_network_objects()
            if not addr_df.empty:
                sheets["address"] = addr_df
        except Exception as e:
            logger.warning("address 객체 추출 실패: %s", e)

        # 주소 그룹 객체
        try:
            ag_df = collector.export_network_group_objects()
            if not ag_df.empty:
                sheets["address_group"] = ag_df
        except Exception as e:
            logger.warning("address_group 객체 추출 실패: %s", e)

        # 서비스 객체
        try:
            svc_df = collector.export_service_objects()
            if not svc_df.empty:
                sheets["service"] = svc_df
        except Exception as e:
            logger.warning("service 객체 추출 실패: %s", e)

        # 서비스 그룹 객체
        try:
            sg_df = collector.export_service_group_objects()
            if not sg_df.empty:
                sheets["service_group"] = sg_df
        except Exception as e:
            logger.warning("service_group 객체 추출 실패: %s", e)

        # 사용이력 (PaloAlto: export_last_hit_date / export_last_hit_date_ssh)
        try:
            vendor_lower = (device.vendor or "").lower()
            if vendor_lower == "paloalto":
                if use_ssh and hasattr(collector, "export_last_hit_date_ssh"):
                    usage_df = collector.export_last_hit_date_ssh()
                else:
                    usage_df = collector.export_last_hit_date()
            elif hasattr(collector, "export_last_hit_date"):
                usage_df = collector.export_last_hit_date()
            else:
                usage_df = pd.DataFrame()

            if not usage_df.empty:
                usage_df = usage_df.rename(columns=_USAGE_COL_MAP)
                usage_df = _add_unused_days(usage_df)
                sheets["usage"] = usage_df
        except Exception as e:
            logger.warning("사용이력 추출 실패: %s", e)

        collector.disconnect()
        return sheets

    try:
        sheets = await loop.run_in_executor(None, _collect)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("장비 데이터 추출 중 예외: %s", e)
        raise HTTPException(status_code=500, detail=f"데이터 추출 실패: {e}")

    if not sheets:
        raise HTTPException(status_code=500, detail="추출된 데이터가 없습니다.")

    today = datetime.date.today().strftime("%Y-%m-%d")
    ip = device.ha_peer_ip if use_ha_peer and device.ha_peer_ip else device.ip_address
    filename = f"{today}_{ip}_policy.xlsx"

    content = await loop.run_in_executor(None, lambda: _df_to_xlsx_bytes(sheets))
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/redundancy-export/{device_id}")
async def export_redundancy(
    device_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    FAT DB의 중복 분석 결과를 fpat 호환 Excel로 내보냅니다.

    fpat Task 8(중복정책분류) 입력 파일로 사용 가능한 형식:
    No, Type(Upper/Lower), Seq, Rule Name, Enable, Action, ...
    """
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"장비 ID {device_id}를 찾을 수 없습니다.")

    # 최신 완료된 중복 분석 태스크 조회
    from sqlalchemy import select
    from app.models.analysis import AnalysisTask, RedundancyPolicySet
    result = await db.execute(
        select(AnalysisTask)
        .filter(
            AnalysisTask.device_id == device_id,
            AnalysisTask.task_type == AnalysisTaskType.REDUNDANCY,
            AnalysisTask.task_status == AnalysisTaskStatus.SUCCESS,
        )
        .order_by(AnalysisTask.completed_at.desc())
        .limit(1)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(
            status_code=404,
            detail=f"장비 {device.name}에 대한 완료된 중복 분석 결과가 없습니다. 먼저 분석을 실행하세요."
        )

    redundancy_sets = await crud.analysis.get_redundancy_policy_sets_by_task(db=db, task_id=task.id)
    if not redundancy_sets:
        raise HTTPException(status_code=404, detail="중복 정책 데이터가 없습니다.")

    rows = []
    for rps in redundancy_sets:
        p = rps.policy
        if p is None:
            continue
        rows.append({
            "No": rps.set_number,
            "Type": rps.type.value,  # "UPPER" | "LOWER"
            "Vsys": p.vsys,
            "Seq": p.seq,
            "Rule Name": p.rule_name,
            "Enable": p.enable,
            "Action": p.action,
            "Source": p.source,
            "User": p.user,
            "Destination": p.destination,
            "Service": p.service,
            "Application": p.application,
            "Security Profile": p.security_profile,
            "Category": p.category,
            "Description": p.description,
        })

    if not rows:
        raise HTTPException(status_code=404, detail="중복 정책 데이터를 구성할 수 없습니다.")

    df = pd.DataFrame(rows)

    import asyncio
    loop = asyncio.get_event_loop()
    content = await loop.run_in_executor(
        None,
        lambda: _df_to_xlsx_bytes({"redundancy": df})
    )

    today = datetime.date.today().strftime("%Y-%m-%d")
    filename = f"{today}_{device.ip_address}_redundancy.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
