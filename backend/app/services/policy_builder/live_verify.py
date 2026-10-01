"""
Policies 편집모드의 대기중 변경사항을 사용자가 실제 장비에서 수동으로 실행한 뒤, 그 결과가
계획(pending change)과 정확히 일치하는지 검증한다. 이 모듈은 장비에 아무것도 쓰지 않는다 —
candidate 설정을 조회해서 비교만 한다. 실제 CLI 실행은 사용자가 장비에서 직접 한다.
"""
import asyncio
import re
from typing import Any, Dict, List, Optional

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.executors import IO_EXECUTOR
from app.core.security import decrypt
from app.models.device import Device
from app.services.firewall.factory import FirewallCollectorFactory
from app.services.policy_builder.insertion_analyzer import build_full_order


class LiveVerifyError(Exception):
    """실제 장비 검증 중 발생한 오류(장비 연결 실패 등)."""


# 정책 1건에 대해 비교하는 전체 컬럼(표시 순서 그대로). 다중값 컬럼은 순서와 무관하게 집합으로 비교한다.
VERIFY_FIELDS = [
    "enable", "action", "from_zone", "source", "user", "to_zone", "destination",
    "service", "application", "description", "log_setting", "security_profile", "category",
]
_MULTI_VALUE_FIELDS = {"from_zone", "source", "user", "to_zone", "destination", "service", "application", "category"}

# 신규 생성 행의 그리드 필드 → Settings(policy_builder_defaults) 키. CLI 생성
# (`cli_generator.generate_policy_set_command`)이 빈 필드를 이 기본값으로 채워 장비에 반영하므로,
# 기대값에도 똑같이 채워야 "FAT은 빈값, 장비는 any"로 오판하지 않는다.
_DEFAULT_KEY_BY_FIELD = {
    "from_zone": "from_zone", "source": "source", "user": "source_user", "to_zone": "to_zone",
    "destination": "destination", "service": "service", "application": "application",
    "log_setting": "log_setting",
}


def _split_values(value: str) -> List[str]:
    return [v.strip().strip('"') for v in re.split(r"[,\n]", value) if v.strip().strip('"')]


def _apply_create_defaults(row: Dict[str, Any], defaults: Dict[str, str]) -> Dict[str, Any]:
    """신규 생성 행의 빈 필드를 CLI 생성과 동일한 기본값으로 채운 기대값 행을 만든다.
    FAT이 설정하지 않는 category/security_profile은 PAN-OS 기본 상태(any/없음)를 기대값으로 한다."""
    expected = dict(row)
    for field, key in _DEFAULT_KEY_BY_FIELD.items():
        if not _split_values(str(expected.get(field) or "")):
            expected[field] = (defaults.get(key) or "").strip()
    expected["category"] = expected.get("category") or "any"
    expected["security_profile"] = expected.get("security_profile") or ""
    return expected


def _compare_field(field: str, expected_raw: Any, actual_raw: Any) -> Dict[str, Any]:
    expected = _normalize_diff_value(field, expected_raw)
    actual = _normalize_diff_value(field, actual_raw)
    if field in _MULTI_VALUE_FIELDS:
        expected_items, actual_items = _split_values(expected), _split_values(actual)
        return {
            "field": field, "expected": ",".join(expected_items), "actual": ",".join(actual_items),
            "expected_count": len(expected_items), "actual_count": len(actual_items),
            "match": sorted(expected_items) == sorted(actual_items),
        }
    return {
        "field": field, "expected": expected, "actual": actual,
        "expected_count": None, "actual_count": None, "match": expected.strip() == actual.strip(),
    }


def _normalize_diff_value(field: str, value: Any) -> str:
    """DIFF_FIELDS 비교 전 값을 문자열로 정규화한다.

    계획된 정책 행(row)의 ``enable``은 DB 컬럼(Policy.enable)에서 온
    Python bool/None인 반면, 장비에서 조회한 candidate 행의 ``enable``은
    Palo Alto 파서가 만드는 "Y"/"N" 문자열이다. 그냥 str()로 캐스팅하면
    str(True) == "True" != "Y"라서 실제 값이 같아도 항상 불일치로
    오판하는 버그가 있었다 — 여기서 형식을 맞춘 뒤 비교한다.
    """
    if value is None:
        return ""
    if field == "enable" and isinstance(value, bool):
        return "Y" if value else "N"
    return str(value)


def _candidate_indices(candidate_df: pd.DataFrame) -> tuple[Dict[tuple, Dict[str, Any]], Dict[str, List[Dict[str, Any]]]]:
    records = candidate_df.to_dict(orient="records") if not candidate_df.empty else []
    by_key: Dict[tuple, Dict[str, Any]] = {}
    by_name: Dict[str, List[Dict[str, Any]]] = {}
    for r in records:
        by_key[(r.get("rule_name"), r.get("vsys"))] = r
        by_name.setdefault(r.get("rule_name"), []).append(r)
    return by_key, by_name


def _match_candidate(
    row: Dict[str, Any],
    by_key: Dict[tuple, Dict[str, Any]],
    by_name: Dict[str, List[Dict[str, Any]]],
) -> Optional[Dict[str, Any]]:
    """(rule_name, vsys)로 우선 매칭한다. 신규 생성행은 vsys를 모르므로(개별 행에 저장하지 않음)
    같은 이름의 candidate 규칙이 정확히 하나뿐일 때만 이름만으로 매칭한다."""
    vsys = row.get("vsys")
    name = row["rule_name"]
    if vsys is not None:
        hit = by_key.get((name, vsys))
        if hit is not None:
            return hit
    candidates = by_name.get(name) or []
    return candidates[0] if len(candidates) == 1 else None


def _neighbors(names: List[str], name: str) -> tuple[Optional[str], Optional[str]]:
    idx = names.index(name)
    return (names[idx - 1] if idx > 0 else None), (names[idx + 1] if idx + 1 < len(names) else None)


def _format_position(prev_name: Optional[str], next_name: Optional[str]) -> str:
    return f"이전: {prev_name or '(맨 위)'} / 다음: {next_name or '(맨 아래)'}"


def _compare_position(
    name: str, vsys: Optional[str], planned_rows: List[Dict[str, Any]], candidate_records: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """이동/신규 정책이 계획한 위치에 들어갔는지, 바로 앞·뒤 정책 이름을 계획 순서와 장비 순서에서 비교한다.
    앞·뒤 정책이 같으면 순서가 맞다고 본다. 신규 생성행은 vsys가 없으므로 같은 vsys 범위로 간주한다."""
    expected_names = [
        r["rule_name"] for r in planned_rows
        if r.get("pending_status") != "deleted" and r.get("vsys") in (None, vsys)
    ]
    actual_names = [r.get("rule_name") for r in candidate_records if r.get("vsys") == vsys]
    expected = _neighbors(expected_names, name)
    actual = _neighbors(actual_names, name)
    return {
        "field": "position", "expected": _format_position(*expected), "actual": _format_position(*actual),
        "expected_count": None, "actual_count": None, "match": expected == actual,
    }


async def verify_pending_changes_against_candidate(
    db: AsyncSession, device: Device, defaults: Dict[str, str],
) -> List[Dict[str, Any]]:
    """대기중 변경사항을 모두 적용한 계획된 최종 상태와, 장비의 실제 candidate 설정을 비교한다.
    정책마다 전체 컬럼의 기대값/실제값/일치 여부를 모두 반환한다(불일치 컬럼만이 아니라)."""
    planned_rows = await build_full_order(db, device.id)
    changed_rows = [r for r in planned_rows if r.get("pending_status")]
    if not changed_rows:
        return []

    try:
        password = decrypt(device.password)
    except Exception:
        raise LiveVerifyError("비밀번호 복호화에 실패했습니다.")

    collector = FirewallCollectorFactory.get_collector(
        source_type=device.vendor.lower(),
        hostname=device.ip_address,
        username=device.username,
        password=password,
    )

    loop = asyncio.get_running_loop()
    try:
        if not await loop.run_in_executor(IO_EXECUTOR, collector.connect):
            raise LiveVerifyError("장비 연결에 실패했습니다.")
        candidate_df = await loop.run_in_executor(IO_EXECUTOR, lambda: collector.export_security_rules(config_type="candidate"))
    except LiveVerifyError:
        raise
    except Exception as e:
        raise LiveVerifyError(f"정책 조회 중 오류가 발생했습니다: {e}")
    finally:
        await loop.run_in_executor(IO_EXECUTOR, collector.disconnect)

    by_key, by_name = _candidate_indices(candidate_df)
    candidate_records = candidate_df.to_dict(orient="records") if not candidate_df.empty else []

    results: List[Dict[str, Any]] = []
    for row in changed_rows:
        pending_status = row["pending_status"]
        candidate_row = _match_candidate(row, by_key, by_name)

        if pending_status == "deleted":
            exists = candidate_row is not None
            results.append({
                "rule_name": row["rule_name"], "vsys": row.get("vsys"),
                "pending_status": pending_status, "status": "mismatch" if exists else "match",
                "fields": [{
                    "field": "존재 여부", "expected": "없음", "actual": "존재" if exists else "없음",
                    "expected_count": None, "actual_count": None, "match": not exists,
                }],
            })
            continue

        if candidate_row is None:
            results.append({
                "rule_name": row["rule_name"], "vsys": row.get("vsys"),
                "pending_status": pending_status, "status": "mismatch",
                "fields": [{
                    "field": "존재 여부", "expected": "존재", "actual": "없음",
                    "expected_count": None, "actual_count": None, "match": False,
                }],
            })
            continue

        expected_row = _apply_create_defaults(row, defaults) if pending_status == "new" else row
        fields = [_compare_field(f, expected_row.get(f), candidate_row.get(f)) for f in VERIFY_FIELDS]
        if pending_status in ("new", "moved"):
            fields.append(_compare_position(row["rule_name"], candidate_row.get("vsys"), planned_rows, candidate_records))

        results.append({
            "rule_name": row["rule_name"], "vsys": row.get("vsys"),
            "pending_status": pending_status,
            "status": "match" if all(f["match"] for f in fields) else "mismatch",
            "fields": fields,
        })

    return results
