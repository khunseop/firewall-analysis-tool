# app/api/api_v1/endpoints/deletion_workflow.py
"""
정책 삭제 워크플로우 API 엔드포인트.

fpat policy_deletion_processor의 14개 태스크를 REST API로 노출합니다.
각 태스크는 Excel/CSV 파일을 업로드 받아 처리 결과를 ZIP으로 반환합니다.
"""

import os
import io
import json
import logging
import zipfile
import datetime
from typing import List, Tuple

import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select
from app.db.session import get_db
from app import crud
from app.models.analysis import AnalysisTaskType, AnalysisTaskStatus
from app.models.policy import Policy
from app.models.network_object import NetworkObject
from app.models.network_group import NetworkGroup
from app.models.service import Service
from app.models.service_group import ServiceGroup
from app.services.deletion_workflow.core.workspace_runner import WorkspaceRunner

logger = logging.getLogger(__name__)
router = APIRouter()

# fpat.yaml 경로 (프로젝트 루트 기준)
_FPAT_YAML = os.path.join(
    os.path.dirname(__file__),          # endpoints/
    '..', '..', '..', '..', '..',       # → backend root
    'fpat', 'fpat.yaml'
)
_FPAT_YAML = os.path.abspath(_FPAT_YAML)

# 태스크별 메타데이터 (태스크 ID = 위저드 실행 순번)
TASK_META = {
    # Phase 0
    1:  {"name": "히트카운트병합",        "input_count": 1, "description": "HA Primary + Secondary 히트카운트 병합 (선택)"},
    # Phase 1
    2:  {"name": "신청정보파싱",          "input_count": 1, "description": "정책 파일 신청정보 파싱"},
    4:  {"name": "중복결과신청정보파싱",  "input_count": 1, "description": "중복분석 결과 파일 신청정보 파싱"},
    5:  {"name": "MISID매핑",             "input_count": 2, "description": "정책 Excel + MIS CSV → MIS ID 추가"},
    6:  {"name": "신청번호추출",          "input_count": 1, "description": "고유 신청 ID 추출"},
    # Phase 2
    7:  {"name": "신청정보취합",          "input_count": 1, "description": "GSAMS 신청정보 취합"},
    8:  {"name": "신청정보매핑",          "input_count": 2, "description": "정책 Excel + GSAMS → 신청정보 매핑"},
    9:  {"name": "자동연장탐지",          "input_count": 1, "description": "자동연장 날짜 업데이트"},
    10: {"name": "예외처리_PaloAlto",     "input_count": 1, "description": "PaloAlto 정책 예외 분류"},
    11: {"name": "예외처리_SECUI",        "input_count": 1, "description": "SECUI/MF2 정책 예외 분류"},
    12: {"name": "사용이력반영",          "input_count": 2, "description": "예외처리 결과 + 히트카운트 → 사용이력 반영"},
    13: {"name": "하단최신정책검증",      "input_count": 1, "description": "하단 최신 정책 검증 및 분류"},
    14: {"name": "중복정책분류",          "input_count": 2, "description": "중복결과(파싱) + 예외처리 → 공지/삭제 분류"},
    15: {"name": "중복만료셋예외처리",    "input_count": 4, "description": "정책원본 + 중복정리/공지/삭제 파일 → 만료셋 예외 분류"},
    16: {"name": "중복정책상태업데이트",  "input_count": 2, "description": "예외처리 + 분류결과 → 중복여부 반영"},
    17: {"name": "중복예외반영",          "input_count": 2, "description": "중복상태 파일 + YAML(선택) → 중복 예외 반영"},
    18: {"name": "통보대상분류",          "input_count": 1, "description": "정책 Excel → 유형별 공지파일 생성"},
}


def _fpat_yaml_path() -> str:
    """fpat.yaml 경로를 반환합니다. 없으면 빈 문자열 반환."""
    return _FPAT_YAML if os.path.exists(_FPAT_YAML) else ""


_SETTINGS_KEY = "deletion_workflow_config"

async def _load_config_dict(db: AsyncSession) -> dict:
    """DB에서 삭제 워크플로우 config를 로드합니다. 없으면 fpat.yaml → 기본값 순으로 폴백."""
    from app.api.api_v1.endpoints.settings import _default_config, _deep_merge, _load_fpat_yaml
    setting = await crud.settings.get_setting(db, key=_SETTINGS_KEY)
    if setting:
        try:
            stored = json.loads(setting.value)
            return _deep_merge(_default_config(), stored)
        except Exception:
            pass
    return _load_fpat_yaml()


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

    config_dict = await _load_config_dict(db)
    runner = WorkspaceRunner(config_dict=config_dict)
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
    db: AsyncSession = Depends(get_db),
):
    """
    FAT DB에서 동기화된 데이터를 fpat 호환 Excel로 내보냅니다.

    - **device_id**: FAT에 등록된 장비 ID

    반환: policy, address, address_group, service, service_group, usage 시트가 포함된 xlsx
    """
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"장비 ID {device_id}를 찾을 수 없습니다.")

    # ── policy 시트 ──────────────────────────────────────────────────
    policies_result = await db.execute(
        select(Policy)
        .filter(Policy.device_id == device_id, Policy.is_active == True)
        .order_by(Policy.vsys, Policy.seq)
    )
    policies = policies_result.scalars().all()

    if not policies:
        raise HTTPException(
            status_code=404,
            detail=f"장비 {device.name}에 동기화된 정책 데이터가 없습니다. 먼저 동기화를 실행하세요."
        )

    policy_rows = [{
        "Vsys": p.vsys,
        "Seq": p.seq,
        "Rule Name": p.rule_name,
        "Enable": "Y" if p.enable else "N",
        "Action": p.action,
        "Source": p.source,
        "User": p.user,
        "Destination": p.destination,
        "Service": p.service,
        "Application": p.application,
        "Security Profile": p.security_profile,
        "Category": p.category,
        "Description": p.description,
    } for p in policies]

    # ── usage 시트 (last_hit_date → Last Hit Date + Unused Days) ─────
    today = datetime.date.today()
    usage_rows = []
    for p in policies:
        if p.last_hit_date:
            unused_days = (today - p.last_hit_date.date()).days
            last_hit_str = p.last_hit_date.strftime("%Y-%m-%d")
        else:
            unused_days = None
            last_hit_str = None
        usage_rows.append({
            "Vsys": p.vsys,
            "Rule Name": p.rule_name,
            "Last Hit Date": last_hit_str,
            "Unused Days": unused_days,
        })

    # ── address 시트 ─────────────────────────────────────────────────
    addr_result = await db.execute(
        select(NetworkObject)
        .filter(NetworkObject.device_id == device_id, NetworkObject.is_active == True)
    )
    address_rows = [{
        "Name": o.name,
        "Type": o.type,
        "IP Address": o.ip_address,
        "Description": o.description,
    } for o in addr_result.scalars().all()]

    # ── address_group 시트 ───────────────────────────────────────────
    ag_result = await db.execute(
        select(NetworkGroup)
        .filter(NetworkGroup.device_id == device_id, NetworkGroup.is_active == True)
    )
    ag_rows = [{
        "Group Name": g.name,
        "Entry": g.members,
        "Description": g.description,
    } for g in ag_result.scalars().all()]

    # ── service 시트 ─────────────────────────────────────────────────
    svc_result = await db.execute(
        select(Service)
        .filter(Service.device_id == device_id, Service.is_active == True)
    )
    svc_rows = [{
        "Name": s.name,
        "Protocol": s.protocol,
        "Port": s.port,
        "Description": s.description,
    } for s in svc_result.scalars().all()]

    # ── service_group 시트 ───────────────────────────────────────────
    sg_result = await db.execute(
        select(ServiceGroup)
        .filter(ServiceGroup.device_id == device_id, ServiceGroup.is_active == True)
    )
    sg_rows = [{
        "Group Name": g.name,
        "Entry": g.members,
        "Description": g.description,
    } for g in sg_result.scalars().all()]

    sheets: dict = {
        "policy": pd.DataFrame(policy_rows),
        "usage": pd.DataFrame(usage_rows),
    }
    if address_rows:
        sheets["address"] = pd.DataFrame(address_rows)
    if ag_rows:
        sheets["address_group"] = pd.DataFrame(ag_rows)
    if svc_rows:
        sheets["service"] = pd.DataFrame(svc_rows)
    if sg_rows:
        sheets["service_group"] = pd.DataFrame(sg_rows)

    import asyncio
    loop = asyncio.get_event_loop()
    content = await loop.run_in_executor(None, lambda: _df_to_xlsx_bytes(sheets))

    filename = f"{today.strftime('%Y-%m-%d')}_{device.ip_address}_policy.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/projects")
async def list_projects(
    device_id: int = None,
    db: AsyncSession = Depends(get_db),
):
    """프로젝트 목록 조회."""
    from app.crud import crud_deletion_workflow as dwcrud
    from app.models.device import Device
    projects = await dwcrud.list_projects(db, device_id=device_id)

    # device 정보 조인 (lazy load 대신 별도 조회)
    result = []
    for p in projects:
        device = await crud.device.get_device(db=db, device_id=p.device_id)
        result.append({
            "id": p.id,
            "device_id": p.device_id,
            "device_name": device.name if device else str(p.device_id),
            "device_ip": device.ip_address if device else "",
            "name": p.name,
            "status": p.status,
            "memo": p.memo,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        })
    return result


@router.post("/projects")
async def create_project(
    device_id: int = Form(...),
    name: str = Form(...),
    memo: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
):
    """새 프로젝트 생성."""
    from app.crud import crud_deletion_workflow as dwcrud
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"장비 ID {device_id}를 찾을 수 없습니다.")

    project = await dwcrud.create_project(db, device_id=device_id, name=name, memo=memo or None)
    await db.commit()
    return {
        "id": project.id,
        "device_id": project.device_id,
        "name": project.name,
        "status": project.status,
        "memo": project.memo,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
    }


@router.get("/projects/{project_id}")
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """프로젝트 상세 조회 (태스크 파일 상태 포함)."""
    from app.crud import crud_deletion_workflow as dwcrud
    project = await dwcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    device = await crud.device.get_device(db=db, device_id=project.device_id)
    files_map = await dwcrud.get_project_files(db, project_id)

    # 파일 상태 목록: task_id, slot, filename, created_at
    file_states = [
        {
            "task_id": k[0],
            "slot": k[1],
            "filename": f.filename,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for k, f in sorted(files_map.items())
    ]

    return {
        "id": project.id,
        "device_id": project.device_id,
        "device_name": device.name if device else str(project.device_id),
        "device_ip": device.ip_address if device else "",
        "device_vendor": device.vendor if device else "",
        "name": project.name,
        "status": project.status,
        "memo": project.memo,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        "files": file_states,
    }


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """프로젝트 삭제 (files cascade)."""
    from app.crud import crud_deletion_workflow as dwcrud
    project = await dwcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    await dwcrud.delete_project(db, project_id)
    await db.commit()
    return {"ok": True}


@router.post("/projects/{project_id}/extract")
async def project_extract(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Task 0: FAT DB에서 데이터를 추출하여 프로젝트에 저장합니다.
    기존 /extract 와 동일한 로직이지만 결과를 DB에 저장합니다.
    """
    from app.crud import crud_deletion_workflow as dwcrud
    project = await dwcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    device_id = project.device_id
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="장비를 찾을 수 없습니다.")

    # 정책 조회
    policies_result = await db.execute(
        select(Policy)
        .filter(Policy.device_id == device_id, Policy.is_active == True)
        .order_by(Policy.vsys, Policy.seq)
    )
    policies = policies_result.scalars().all()
    if not policies:
        raise HTTPException(
            status_code=404,
            detail=f"장비 {device.name}에 동기화된 정책 데이터가 없습니다. 먼저 동기화를 실행하세요."
        )

    today = datetime.date.today()
    policy_rows = [{
        "Vsys": p.vsys, "Seq": p.seq, "Rule Name": p.rule_name,
        "Enable": "Y" if p.enable else "N", "Action": p.action, "Source": p.source,
        "User": p.user, "Destination": p.destination, "Service": p.service,
        "Application": p.application, "Security Profile": p.security_profile,
        "Category": p.category, "Description": p.description,
    } for p in policies]

    usage_rows = [{
        "Vsys": p.vsys,
        "Rule Name": p.rule_name,
        "Last Hit Date": p.last_hit_date.strftime("%Y-%m-%d") if p.last_hit_date else None,
        "Unused Days": (today - p.last_hit_date.date()).days if p.last_hit_date else None,
    } for p in policies]

    addr_result = await db.execute(
        select(NetworkObject).filter(NetworkObject.device_id == device_id, NetworkObject.is_active == True)
    )
    address_rows = [{"Name": o.name, "Type": o.type, "IP Address": o.ip_address, "Description": o.description}
                    for o in addr_result.scalars().all()]

    ag_result = await db.execute(
        select(NetworkGroup).filter(NetworkGroup.device_id == device_id, NetworkGroup.is_active == True)
    )
    ag_rows = [{"Group Name": g.name, "Entry": g.members, "Description": g.description}
               for g in ag_result.scalars().all()]

    svc_result = await db.execute(
        select(Service).filter(Service.device_id == device_id, Service.is_active == True)
    )
    svc_rows = [{"Name": s.name, "Protocol": s.protocol, "Port": s.port, "Description": s.description}
                for s in svc_result.scalars().all()]

    sg_result = await db.execute(
        select(ServiceGroup).filter(ServiceGroup.device_id == device_id, ServiceGroup.is_active == True)
    )
    sg_rows = [{"Group Name": g.name, "Entry": g.members, "Description": g.description}
               for g in sg_result.scalars().all()]

    sheets = {"policy": pd.DataFrame(policy_rows), "usage": pd.DataFrame(usage_rows)}
    if address_rows:
        sheets["address"] = pd.DataFrame(address_rows)
    if ag_rows:
        sheets["address_group"] = pd.DataFrame(ag_rows)
    if svc_rows:
        sheets["service"] = pd.DataFrame(svc_rows)
    if sg_rows:
        sheets["service_group"] = pd.DataFrame(sg_rows)

    import asyncio
    loop = asyncio.get_event_loop()
    content = await loop.run_in_executor(None, lambda: _df_to_xlsx_bytes(sheets))

    filename = f"{today.strftime('%Y-%m-%d')}_{device.ip_address}_policy.xlsx"
    await dwcrud.upsert_file(db, project_id=project_id, task_id=0, slot="output_0",
                             filename=filename, data=content)
    await dwcrud.update_project_status(db, project, "running")
    await db.commit()
    return {"ok": True, "filename": filename, "task_id": 0, "slot": "output_0"}


@router.post("/projects/{project_id}/tasks/{task_id}/upload")
async def upload_external_file(
    project_id: int,
    task_id: int,
    slot: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """외부 파일을 프로젝트에 저장합니다 (실행 없음)."""
    from app.crud import crud_deletion_workflow as dwcrud
    project = await dwcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    if slot not in ("external_0", "external_1", "external_2"):
        raise HTTPException(status_code=400, detail=f"유효하지 않은 slot: {slot}")

    data = await file.read()
    await dwcrud.upsert_file(db, project_id=project_id, task_id=task_id, slot=slot,
                             filename=file.filename, data=data)
    await db.commit()
    return {"ok": True, "filename": file.filename, "task_id": task_id, "slot": slot}


async def _build_duplicate_policy_yaml(db: AsyncSession, device_id: int, device) -> bytes | None:
    """
    Settings의 duplicate_policies에서 해당 장비 + 유효기간 예외만 추출해 YAML bytes 생성.
    유효 항목 없으면 None 반환.
    """
    import yaml as _yaml
    import datetime as _dt

    setting = await crud.settings.get_setting(db, key="deletion_workflow_config")
    if not setting:
        return None

    try:
        cfg = json.loads(setting.value) if isinstance(setting.value, str) else setting.value
        items = cfg.get("exceptions", {}).get("duplicate_policies", [])
    except Exception:
        return None

    today = _dt.date.today()
    valid = []
    for item in items:
        if item.get("device_id") != device_id:
            continue
        try:
            exp = _dt.date.fromisoformat(item["expires_at"])
            reg = _dt.date.fromisoformat(item["registered_at"])
        except (KeyError, ValueError):
            continue
        if exp >= today and reg < today:
            valid.append({
                "name": item.get("name", ""),
                "reason": item.get("reason", ""),
                "registered_at": item["registered_at"],
                "expires_at": item["expires_at"],
            })

    if not valid:
        return None

    fw_key = device.ip_address if device else str(device_id)
    return _yaml.dump({fw_key: valid}, allow_unicode=True, default_flow_style=False).encode("utf-8")


@router.post("/projects/{project_id}/tasks/{task_id}/run")
async def run_project_task(
    project_id: int,
    task_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    프로젝트 내에서 태스크를 실행합니다.
    입력 파일은 프로젝트 파일에서 자동으로 resolve됩니다.
    외부 파일이 필요한 태스크는 먼저 /upload로 파일을 저장해야 합니다.
    """
    from app.crud import crud_deletion_workflow as dwcrud
    from app.services.deletion_workflow.core.input_resolver import resolve_inputs, MissingInputError, get_vendor_task_id

    project = await dwcrud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    device = await crud.device.get_device(db=db, device_id=project.device_id)
    vendor = device.vendor if device else ""

    # ── Task 3: FAT DB 중복분석 → project file 자동 저장 ──────────────────
    if task_id == 3:
        return await _run_task17_from_db(project_id, project.device_id, device, db, dwcrud)

    if task_id not in TASK_META:
        raise HTTPException(status_code=400, detail=f"유효하지 않은 태스크 번호: {task_id}")

    # Task 10/11 자동 선택: 벤더에 따라 실제 실행할 task_id 결정
    effective_task_id = task_id
    if task_id in (10, 11):
        effective_task_id = get_vendor_task_id(vendor)

    # Task 17: external_1(YAML) 없으면 Settings 예외 목록으로 자동 생성
    if task_id == 17:
        existing_yaml = await dwcrud.get_file(db, project_id=project_id, task_id=17, slot="external_1")
        if existing_yaml is None:
            yaml_bytes = await _build_duplicate_policy_yaml(db, project.device_id, device)
            if yaml_bytes:
                await dwcrud.upsert_file(db, project_id=project_id, task_id=17, slot="external_1",
                                         filename="duplicate_exceptions_auto.yaml", data=yaml_bytes)

    files_map = await dwcrud.get_project_files(db, project_id)

    try:
        input_files = resolve_inputs(effective_task_id, files_map, vendor)
    except MissingInputError as e:
        raise HTTPException(status_code=422, detail=str(e))

    contents = [data for data, _ in input_files]
    filenames = [name for _, name in input_files]

    extra_kwargs = {}
    if effective_task_id == 10:
        extra_kwargs["vendor"] = "paloalto"
    elif effective_task_id == 11:
        extra_kwargs["vendor"] = "secui"

    import asyncio
    loop = asyncio.get_event_loop()
    config_dict = await _load_config_dict(db)
    runner = WorkspaceRunner(config_dict=config_dict)

    try:
        output_files = await loop.run_in_executor(
            None,
            lambda: runner.run_task(effective_task_id, contents, filenames, **extra_kwargs)
        )
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception(f"Project {project_id} Task {effective_task_id} 실행 오류: {e}")
        raise HTTPException(status_code=500, detail=f"태스크 실행 실패: {str(e)}")

    if not output_files:
        raise HTTPException(status_code=500, detail="태스크 실행 완료됐으나 출력 파일이 없습니다.")

    # 출력 파일을 프로젝트에 저장 (output_0, output_1, ...)
    saved = []
    for idx, (fname, data) in enumerate(output_files):
        slot = f"output_{idx}"
        await dwcrud.upsert_file(db, project_id=project_id, task_id=effective_task_id,
                                 slot=slot, filename=fname, data=data)
        saved.append({"slot": slot, "filename": fname})

    await db.commit()
    return {"ok": True, "task_id": effective_task_id, "outputs": saved}


@router.get("/projects/{project_id}/tasks/{task_id}/download")
async def download_task_file(
    project_id: int,
    task_id: int,
    slot: str = "output_0",
    db: AsyncSession = Depends(get_db),
):
    """저장된 태스크 파일을 다운로드합니다."""
    from app.crud import crud_deletion_workflow as dwcrud
    f = await dwcrud.get_file(db, project_id=project_id, task_id=task_id, slot=slot)
    if not f:
        raise HTTPException(status_code=404, detail=f"파일을 찾을 수 없습니다: task {task_id} / {slot}")

    ext = os.path.splitext(f.filename)[1].lower()
    if ext == ".xlsx":
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif ext == ".csv":
        media = "text/csv"
    else:
        media = "application/octet-stream"

    return Response(
        content=f.file_data,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{f.filename}"'},
    )


async def _run_task17_from_db(project_id, device_id, device, db, dwcrud):
    """Task 17 (중복정책분석): FAT DB 중복분석 결과를 Excel로 변환하여 project file 저장."""
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
            detail="FAT DB에 완료된 중복 분석 결과가 없습니다. 분석 → 중복 분석을 먼저 실행하세요."
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
            "Type": rps.type.value,
            "Vsys": p.vsys, "Seq": p.seq, "Rule Name": p.rule_name,
            "Enable": "Y" if p.enable else "N", "Action": p.action, "Source": p.source,
            "User": p.user, "Destination": p.destination, "Service": p.service,
            "Application": p.application, "Security Profile": p.security_profile,
            "Category": p.category, "Description": p.description,
        })

    if not rows:
        raise HTTPException(status_code=404, detail="중복 정책 행을 생성할 수 없습니다.")

    import asyncio
    loop = asyncio.get_event_loop()
    content = await loop.run_in_executor(
        None, lambda: _df_to_xlsx_bytes({"redundancy": pd.DataFrame(rows)})
    )

    today = datetime.date.today().strftime("%Y-%m-%d")
    device_ip = device.ip_address if device else str(device_id)
    filename = f"{today}_{device_ip}_redundancy.xlsx"

    await dwcrud.upsert_file(db, project_id=project_id, task_id=3, slot="output_0",
                             filename=filename, data=content)
    await db.commit()
    return {"ok": True, "task_id": 3, "outputs": [{"slot": "output_0", "filename": filename}]}


# ─────────────────────────────────────────────────────────────────────────────
# 기존 레거시 엔드포인트 (하위 호환)
# ─────────────────────────────────────────────────────────────────────────────

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
            "Enable": "Y" if p.enable else "N",
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
