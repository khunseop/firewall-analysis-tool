import datetime
import json
import logging
import os
from typing import Any, Dict, List

import yaml

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas
from app.db.session import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# fpat.yaml 경로
_FPAT_YAML = os.path.abspath(os.path.join(
    os.path.dirname(__file__),
    '..', '..', '..', '..', '..',
    'fpat', 'fpat.yaml',
))

_SETTINGS_KEY = 'deletion_workflow_config'


# ──────────────────────────────────────────────
# 헬퍼 함수
# ──────────────────────────────────────────────

def _default_config() -> dict:
    """UI 렌더링용 기본 설정 (fpat.yaml 구조와 동일)"""
    return {
        # ── 파일 관리 ───────────────────────────────────────────────
        "file_management": {
            "policy_version_format": "_v{version}",
            "final_version_suffix": "_vf",
            "default_extension": ".xlsx",
        },
        # request_extractor.py: config.get('file_naming.request_id_prefix')
        "file_naming": {
            "request_id_prefix": "GSAMS신청번호_",
        },
        # mis_id_adder.py: config.get('file_extensions.csv')
        "file_extensions": {
            "csv": ".csv",
        },
        # ── 분석 기준 ───────────────────────────────────────────────
        "analysis_criteria": {
            "unused_threshold_days": 90,
        },
        # exception_handler.py: config.get('timeframes.recent_policy_days')
        "timeframes": {
            "recent_policy_days": 90,
        },
        # ── 예외 ────────────────────────────────────────────────────
        "exceptions": {
            "request_ids": [],
            "policy_rules": [],
            "static_list": [],
            "duplicate_policies": [],
        },
        # ── 정책 처리 ───────────────────────────────────────────────
        "policy_processing": {
            "request_parsing": {
                "gsams_3_pattern": "",
                "gsams_1_rulename_pattern": "",
                "gsams_1_user_pattern": "",
                "gsams_1_desc_pattern": "",
                "gsams_1_date_pattern": "",
            },
            "analysis_markers": {
                "paloalto": {
                    "deny_standard_rule_name": "",
                    "infrastructure_prefixes": [],
                    "infrastructure_exception_label": "인프라정책",
                    "special_policy_label": "라인그룹정책",
                },
                "secui": {
                    "deny_standard_description_keyword": "",
                    "infrastructure_exception_label": "인프라정책",
                },
            },
            "aggregation": {
                "column_mapping": {},
                "final_columns": [],
                "email_domain_map": {},
                "title_bracket_pattern": "",
            },
        },
        # ── 통보대상 분류 컬럼 (notification_classifier.py) ──────────
        # columns.all       : 공지파일에 포함할 전체 컬럼 목록
        # columns.no_history: 신청이력 없는 정책 공지용 컬럼 목록
        # columns.date_columns: 날짜 포맷(YYYY-MM-DD)을 적용할 컬럼 목록
        # translated_columns : 내부 컬럼명 → 공지용 한글 이름 매핑
        "columns": {
            "all": [],
            "no_history": [],
            "date_columns": [],
        },
        "translated_columns": {},
        # ── 엑셀 스타일 ─────────────────────────────────────────────
        "excel_styles": {
            "header_fill_color": "E0E0E0",
            "history_fill_color": "CCFFFF",
        },
    }


def _deep_merge(base: dict, override: dict) -> dict:
    """base에 override를 재귀적으로 병합합니다. override 값이 우선합니다."""
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def _load_fpat_yaml() -> dict:
    """fpat.yaml 파일에서 설정을 로드합니다. 없으면 기본값 반환."""
    if not os.path.exists(_FPAT_YAML):
        return _default_config()
    try:
        with open(_FPAT_YAML, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f) or {}
        return _deep_merge(_default_config(), data)
    except Exception as e:
        logger.warning(f"fpat.yaml 로드 실패: {e}")
        return _default_config()


def _write_fpat_yaml(config: dict) -> None:
    """설정을 fpat.yaml 파일에 동기화합니다."""
    if not os.path.exists(os.path.dirname(_FPAT_YAML)):
        return
    try:
        with open(_FPAT_YAML, 'w', encoding='utf-8') as f:
            yaml.dump(
                config, f,
                allow_unicode=True,
                default_flow_style=False,
                sort_keys=False,
            )
        logger.info(f"fpat.yaml 업데이트: {_FPAT_YAML}")
    except Exception as e:
        logger.warning(f"fpat.yaml 쓰기 실패 (DB는 저장됨): {e}")


# ──────────────────────────────────────────────
# 일반 설정 엔드포인트
# ──────────────────────────────────────────────

@router.get("/", response_model=List[schemas.Settings])
async def read_settings(db: AsyncSession = Depends(get_db)):
    """모든 설정 조회"""
    return await crud.settings.get_all_settings(db)


@router.get("/{key}", response_model=schemas.Settings)
async def read_setting(key: str, db: AsyncSession = Depends(get_db)):
    """특정 설정 조회"""
    setting = await crud.settings.get_setting(db, key=key)
    if setting is None:
        raise HTTPException(status_code=404, detail="Setting not found")
    return setting


@router.put("/{key}", response_model=schemas.Settings)
async def update_setting(
    key: str,
    setting_in: schemas.SettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """설정 업데이트 (없으면 생성)"""
    setting = await crud.settings.get_setting(db, key=key)
    if setting is None:
        setting_create = schemas.SettingsCreate(
            key=key,
            value=setting_in.value,
            description=setting_in.description,
        )
        created_setting = await crud.settings.create_setting(db, setting_create)
        if key == "sync_parallel_limit":
            from app.services.sync.tasks import reset_sync_semaphore
            await reset_sync_semaphore()
        return created_setting

    updated_setting = await crud.settings.update_setting(
        db=db, db_obj=setting, obj_in=setting_in
    )
    if key == "sync_parallel_limit":
        from app.services.sync.tasks import reset_sync_semaphore
        await reset_sync_semaphore()
    return updated_setting


# ──────────────────────────────────────────────
# 정책 삭제 워크플로우 설정 엔드포인트
# ──────────────────────────────────────────────

class DeletionWorkflowConfigPayload(BaseModel):
    config: Dict[str, Any]


@router.get("/deletion-workflow/config")
async def get_deletion_workflow_config(db: AsyncSession = Depends(get_db)):
    """
    정책 삭제 워크플로우 설정 조회 (fpat.yaml 구조).

    우선순위: DB → fpat.yaml 파일 → 기본값
    """
    setting = await crud.settings.get_setting(db, key=_SETTINGS_KEY)
    if setting:
        try:
            stored = json.loads(setting.value)
            return _deep_merge(_default_config(), stored)
        except Exception:
            pass
    return _load_fpat_yaml()


@router.put("/deletion-workflow/config")
async def update_deletion_workflow_config(
    payload: DeletionWorkflowConfigPayload,
    db: AsyncSession = Depends(get_db),
):
    """
    정책 삭제 워크플로우 설정 저장 (fpat.yaml 구조).

    DB에 저장하고 fpat.yaml 파일에도 동기화합니다.
    """
    value = json.dumps(payload.config, ensure_ascii=False)
    setting = await crud.settings.get_setting(db, key=_SETTINGS_KEY)
    if setting is None:
        await crud.settings.create_setting(
            db,
            schemas.SettingsCreate(
                key=_SETTINGS_KEY,
                value=value,
                description='정책 삭제 워크플로우 설정 (fpat.yaml 형식)',
            ),
        )
    else:
        await crud.settings.update_setting(
            db=db,
            db_obj=setting,
            obj_in=schemas.SettingsUpdate(value=value),
        )

    _write_fpat_yaml(payload.config)
    return payload.config


@router.get("/deletion-workflow/config/export")
async def export_deletion_workflow_config(db: AsyncSession = Depends(get_db)):
    """현재 삭제 워크플로우 설정을 JSON 파일로 다운로드합니다."""
    setting = await crud.settings.get_setting(db, key=_SETTINGS_KEY)
    if setting:
        try:
            config = _deep_merge(_default_config(), json.loads(setting.value))
        except Exception:
            config = _load_fpat_yaml()
    else:
        config = _load_fpat_yaml()

    today = datetime.date.today().strftime("%Y%m%d")
    filename = f"deletion_workflow_config_{today}.json"
    content = json.dumps({"version": 1, "exported_at": today, "config": config},
                         ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/deletion-workflow/config/import")
async def import_deletion_workflow_config(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """JSON 백업 파일에서 삭제 워크플로우 설정을 복구합니다."""
    raw = await file.read()
    try:
        data = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="유효하지 않은 JSON 파일입니다.")

    # {"version":1, "config":{...}} 형식 또는 config 직접 포함 둘 다 허용
    config = data.get("config", data) if isinstance(data, dict) else None
    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="설정 형식이 올바르지 않습니다.")

    value = json.dumps(config, ensure_ascii=False)
    setting = await crud.settings.get_setting(db, key=_SETTINGS_KEY)
    if setting is None:
        await crud.settings.create_setting(
            db,
            schemas.SettingsCreate(
                key=_SETTINGS_KEY,
                value=value,
                description='정책 삭제 워크플로우 설정 (fpat.yaml 형식)',
            ),
        )
    else:
        await crud.settings.update_setting(
            db=db,
            db_obj=setting,
            obj_in=schemas.SettingsUpdate(value=value),
        )

    _write_fpat_yaml(config)
    return {"ok": True, "message": "설정이 복구되었습니다."}


@router.post("/deletion-workflow/parse-yaml")
async def parse_yaml_to_json(request: Request):
    """YAML 텍스트를 JSON으로 파싱하여 반환합니다."""
    raw = await request.body()
    try:
        result = yaml.safe_load(raw.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"YAML 파싱 오류: {e}")
    return {"data": result}


@router.get("/deletion-workflow/config/yaml")
async def get_deletion_workflow_config_yaml(db: AsyncSession = Depends(get_db)):
    """현재 삭제 워크플로우 설정을 YAML 텍스트로 반환합니다."""
    setting = await crud.settings.get_setting(db, key=_SETTINGS_KEY)
    if setting:
        try:
            config = _deep_merge(_default_config(), json.loads(setting.value))
        except Exception:
            config = _load_fpat_yaml()
    else:
        config = _load_fpat_yaml()

    yaml_text = yaml.dump(config, allow_unicode=True, default_flow_style=False, sort_keys=False)
    return Response(content=yaml_text, media_type="text/plain; charset=utf-8")


@router.put("/deletion-workflow/config/yaml")
async def update_deletion_workflow_config_yaml(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """raw YAML 텍스트로 삭제 워크플로우 설정을 저장합니다."""
    raw = await request.body()
    try:
        yaml_text = raw.decode("utf-8")
        config = yaml.safe_load(yaml_text)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"YAML 파싱 오류: {e}")

    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="YAML은 매핑(dict) 형식이어야 합니다.")

    value = json.dumps(config, ensure_ascii=False)
    setting = await crud.settings.get_setting(db, key=_SETTINGS_KEY)
    if setting is None:
        await crud.settings.create_setting(
            db,
            schemas.SettingsCreate(
                key=_SETTINGS_KEY,
                value=value,
                description='정책 삭제 워크플로우 설정 (fpat.yaml 형식)',
            ),
        )
    else:
        await crud.settings.update_setting(
            db=db,
            db_obj=setting,
            obj_in=schemas.SettingsUpdate(value=value),
        )

    _write_fpat_yaml(config)
    return {"ok": True}
