import json
import logging
import os
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
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
        "file_management": {
            "policy_version_format": "_v{version}",
            "final_version_suffix": "_vf",
            "request_id_prefix": "request_id_",
            "default_extension": ".xlsx",
        },
        "analysis_criteria": {
            "recent_policy_days": 90,
            "unused_threshold_days": 90,
        },
        "exceptions": {
            "request_ids": [],
            "policy_rules": [],
            "static_list": [],
        },
        "policy_processing": {
            "request_parsing": {},
            "analysis_markers": {
                "paloalto": {
                    "deny_standard_rule_name": "Deny_All",
                    "infrastructure_prefixes": ["X", "X-", "SYS_"],
                    "infrastructure_exception_label": "인프라정책",
                    "special_policy_label": "특수정책",
                },
                "secui": {
                    "deny_standard_description_keyword": "차단기준",
                    "infrastructure_exception_label": "인프라정책",
                },
            },
            "aggregation": {
                "column_mapping": {},
                "final_columns": [
                    "REQUEST_ID", "REQUEST_START_DATE",
                    "REQUEST_END_DATE", "REQUESTER_ID",
                ],
                "email_domain_map": {},
                "title_bracket_pattern": r"^\[([^\[\]]{1,8})\]",
            },
        },
        "excel_styles": {
            "header_fill_color": "E0E0E0",
            "history_fill_color": "CCFFFF",
        },
    }


def _load_fpat_yaml() -> dict:
    """fpat.yaml 파일에서 설정을 로드합니다. 없으면 기본값 반환."""
    if not os.path.exists(_FPAT_YAML):
        return _default_config()
    try:
        import yaml
        with open(_FPAT_YAML, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f) or {}
        base = _default_config()
        # 기본값 위에 파일 값을 덮어씁니다 (1 depth merge)
        for k, v in data.items():
            if k in base and isinstance(v, dict) and isinstance(base[k], dict):
                base[k].update(v)
            else:
                base[k] = v
        return base
    except Exception as e:
        logger.warning(f"fpat.yaml 로드 실패: {e}")
        return _default_config()


def _write_fpat_yaml(config: dict) -> None:
    """설정을 fpat.yaml 파일에 동기화합니다."""
    if not os.path.exists(os.path.dirname(_FPAT_YAML)):
        return
    try:
        import yaml
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
            return json.loads(setting.value)
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
