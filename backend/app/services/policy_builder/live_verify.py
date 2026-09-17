"""
Policies 편집모드의 대기중 변경사항을 사용자가 실제 장비에서 수동으로 실행한 뒤, 그 결과가
계획(pending change)과 정확히 일치하는지 검증한다. 이 모듈은 장비에 아무것도 쓰지 않는다 —
candidate 설정을 조회해서 비교만 한다. 실제 CLI 실행은 사용자가 장비에서 직접 한다.
"""
import asyncio
from typing import Any, Dict, List, Optional

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.executors import IO_EXECUTOR
from app.core.security import decrypt
from app.models.device import Device
from app.services.firewall.factory import FirewallCollectorFactory
from app.services.live_policy_diff import DIFF_FIELDS
from app.services.policy_builder.insertion_analyzer import build_full_order


class LiveVerifyError(Exception):
    """실제 장비 검증 중 발생한 오류(장비 연결 실패 등)."""


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


async def verify_pending_changes_against_candidate(db: AsyncSession, device: Device) -> List[Dict[str, Any]]:
    """대기중 변경사항을 모두 적용한 계획된 최종 상태와, 장비의 실제 candidate 설정을 비교한다."""
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

    results: List[Dict[str, Any]] = []
    for row in changed_rows:
        pending_status = row["pending_status"]
        candidate_row = _match_candidate(row, by_key, by_name)

        if pending_status == "deleted":
            status = "mismatch" if candidate_row is not None else "match"
            results.append({
                "rule_name": row["rule_name"], "vsys": row.get("vsys"),
                "pending_status": pending_status, "status": status, "mismatches": [],
            })
            continue

        if candidate_row is None:
            results.append({
                "rule_name": row["rule_name"], "vsys": row.get("vsys"),
                "pending_status": pending_status, "status": "mismatch",
                "mismatches": [{"field": "존재 여부", "expected": "존재", "actual": "없음"}],
            })
            continue

        mismatches = []
        for field in DIFF_FIELDS:
            expected = str(row.get(field, "")) if row.get(field) is not None else ""
            actual = str(candidate_row.get(field, "")) if candidate_row.get(field) is not None else ""
            if expected != actual:
                mismatches.append({"field": field, "expected": expected, "actual": actual})

        results.append({
            "rule_name": row["rule_name"], "vsys": row.get("vsys"),
            "pending_status": pending_status,
            "status": "match" if not mismatches else "mismatch",
            "mismatches": mismatches,
        })

    return results
