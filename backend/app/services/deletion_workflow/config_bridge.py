"""삭제 워크플로우 설정(Settings) 연동 로직.

config 로드, Task 15 예외 누적 저장, 중복 예외 YAML 생성을 담당합니다.
"""
import datetime
import io
import json
import logging
from typing import List, Optional, Tuple

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas

logger = logging.getLogger(__name__)

SETTINGS_KEY = "deletion_workflow_config"


async def load_config_dict(db: AsyncSession) -> dict:
    """DB에서 삭제 워크플로우 config를 로드합니다. 없으면 fpat.yaml → 기본값 순으로 폴백."""
    from app.api.api_v1.endpoints.settings import _default_config, _deep_merge, _load_fpat_yaml
    setting = await crud.settings.get_setting(db, key=SETTINGS_KEY)
    if setting:
        try:
            stored = json.loads(setting.value)
            return _deep_merge(_default_config(), stored)
        except Exception:
            pass
    return _load_fpat_yaml()


async def save_task15_exceptions_to_settings(
    db: AsyncSession,
    device_id: int,
    output_files: List[Tuple[str, bytes]],
    reference_date: Optional[datetime.date],
    unused_threshold_days: int,
) -> None:
    """
    Task 15 출력 파일(중복정리 결과 Excel의 '중복정책정리'+'예외' 시트)에서
    '미사용예외' 컬럼이 True인 대상을 추출해 Settings의 duplicate_policies에 누적 저장.
    (device_id, name) 기준 중복 시 expires_at이 더 긴 항목으로 교체.
    """
    df_exc: Optional[pd.DataFrame] = None
    for fname, data in output_files:
        if not fname.endswith('.xlsx'):
            continue
        try:
            sheets = pd.read_excel(io.BytesIO(data), sheet_name=None)
        except Exception:
            continue
        target_sheets = [df for name, df in sheets.items() if name in ('중복정책정리', '예외')]
        if not target_sheets:
            continue
        df_exc = pd.concat(target_sheets, ignore_index=True)
        break

    if df_exc is None or df_exc.empty or 'Rule Name' not in df_exc.columns or '미사용예외' not in df_exc.columns:
        return

    df_exc = df_exc[df_exc['미사용예외'] == True]  # noqa: E712
    if df_exc.empty:
        return

    today = reference_date or datetime.date.today()
    expires_at = today + datetime.timedelta(days=unused_threshold_days)

    new_entries: List[dict] = []
    for _, row in df_exc.drop_duplicates(subset=['Rule Name']).iterrows():
        name = row.get('Rule Name')
        if not name:
            continue
        new_entries.append({
            "device_id": device_id,
            "name": str(name),
            "reason": f"중복정책_{row.get('비고', '')}",
            "registered_at": today.strftime('%Y-%m-%d'),
            "expires_at": expires_at.strftime('%Y-%m-%d'),
        })

    if not new_entries:
        return

    setting = await crud.settings.get_setting(db, key=SETTINGS_KEY)
    if setting:
        try:
            cfg = json.loads(setting.value)
        except Exception:
            cfg = {}
    else:
        cfg = {}

    existing: List[dict] = cfg.get("exceptions", {}).get("duplicate_policies", [])

    # (device_id, name) 키로 인덱싱, expires_at이 더 긴 것으로 교체
    merged: dict = {(e["device_id"], e["name"]): e for e in existing}
    for entry in new_entries:
        key = (entry["device_id"], entry["name"])
        if key in merged:
            try:
                existing_exp = merged[key].get("expires_at", "")
                new_exp = entry.get("expires_at", "")
                if new_exp > existing_exp:
                    merged[key] = entry
            except Exception:
                merged[key] = entry
        else:
            merged[key] = entry

    updated_list = list(merged.values())
    if "exceptions" not in cfg:
        cfg["exceptions"] = {}
    cfg["exceptions"]["duplicate_policies"] = updated_list

    value = json.dumps(cfg, ensure_ascii=False)
    if setting:
        await crud.settings.update_setting(
            db=db, db_obj=setting,
            obj_in=schemas.SettingsUpdate(value=value),
        )
    else:
        await crud.settings.create_setting(
            db,
            schemas.SettingsCreate(
                key=SETTINGS_KEY,
                value=value,
                description='정책 삭제 워크플로우 설정 (fpat.yaml 형식)',
            ),
        )

    logger.info(f"Task 15 예외 {len(new_entries)}건 → Settings duplicate_policies 저장 완료")


async def build_duplicate_policy_yaml(
    db: AsyncSession, device_id: int, device, reference_date: datetime.date = None
) -> bytes | None:
    """
    Settings의 duplicate_policies에서 해당 장비 + 유효기간 예외만 추출해 YAML bytes 생성.
    유효 항목 없으면 None 반환.
    """
    import yaml as _yaml

    setting = await crud.settings.get_setting(db, key=SETTINGS_KEY)
    if not setting:
        return None

    try:
        cfg = json.loads(setting.value) if isinstance(setting.value, str) else setting.value
        items = cfg.get("exceptions", {}).get("duplicate_policies", [])
    except Exception:
        return None

    today = reference_date or datetime.date.today()
    valid = []
    for item in items:
        if item.get("device_id") != device_id:
            continue
        try:
            exp = datetime.date.fromisoformat(item["expires_at"])
            reg = datetime.date.fromisoformat(item["registered_at"])
        except (KeyError, ValueError):
            continue
        if exp >= today and reg >= today:
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
