# backend/app/services/live_policy_diff.py
"""
Palo Alto 장비의 running/candidate 설정을 실시간으로 조회해 정책을 비교합니다.

DB의 sync 시점 diff(`/firewall/policy-diff`)는 ChangeLog(변경분)를 이용하는데,
과거 임의 sync 시점의 전체 정책 스냅샷은 DB에 저장돼 있지 않아 Running/Candidate와
짝지을 수 없다. 그래서 이 모듈은 장비에 직접 붙어 두 설정을 통째로 받아와
rule_name+vsys로 매칭한 뒤 필드 단위로 직접 비교하는 별도 경로다.
"""
import asyncio
import datetime
from typing import Any, Dict

import pandas as pd

from app.core.executors import IO_EXECUTOR
from app.core.security import decrypt
from app.models.device import Device
from app.services.firewall.factory import FirewallCollectorFactory

# 기존 sync 시점 diff(`firewall_query.get_policy_diff`)와 동일한 필드 세트를 비교한다 —
# 두 diff 결과를 프론트의 같은 컴포넌트로 렌더링하므로 항목이 어긋나면 안 된다.
# seq(순서)는 일부러 뺀다 — 정책 하나만 옮겨도 그 사이에 낀 정책들의 seq가 전부 밀려서,
# 실제로는 안 바뀐 정책들까지 "변경"으로 잡히는 노이즈가 너무 크다.
DIFF_FIELDS = ["enable", "action", "source", "destination", "service", "description", "user", "application", "security_profile", "category"]


class LivePolicyDiffError(Exception):
    """실시간 running/candidate 비교 중 발생한 오류(장비 미지원, 연결 실패 등)."""


def _row_key(row: Dict[str, Any]) -> tuple:
    return (row.get("rule_name"), row.get("vsys"))


def _rows_by_key(df: pd.DataFrame) -> Dict[tuple, Dict[str, Any]]:
    records = df.to_dict(orient="records") if not df.empty else []
    return {_row_key(r): r for r in records}


async def get_live_running_candidate_diff(device: Device) -> dict:
    """장비에 직접 접속해 running/candidate 정책을 비교한 diff를 반환합니다."""
    if (device.vendor or "").lower() != "paloalto":
        raise LivePolicyDiffError("실시간 running/candidate 비교는 Palo Alto 장비만 지원합니다.")

    try:
        password = decrypt(device.password)
    except Exception:
        raise LivePolicyDiffError("비밀번호 복호화에 실패했습니다.")

    collector = FirewallCollectorFactory.get_collector(
        source_type=device.vendor.lower(),
        hostname=device.ip_address,
        username=device.username,
        password=password,
    )

    loop = asyncio.get_running_loop()
    try:
        if not await loop.run_in_executor(IO_EXECUTOR, collector.connect):
            raise LivePolicyDiffError("장비 연결에 실패했습니다.")
        running_df = await loop.run_in_executor(IO_EXECUTOR, lambda: collector.export_security_rules(config_type="running"))
        candidate_df = await loop.run_in_executor(IO_EXECUTOR, lambda: collector.export_security_rules(config_type="candidate"))
    except LivePolicyDiffError:
        raise
    except Exception as e:
        raise LivePolicyDiffError(f"정책 조회 중 오류가 발생했습니다: {e}")
    finally:
        await loop.run_in_executor(IO_EXECUTOR, collector.disconnect)

    running_by_key = _rows_by_key(running_df)
    candidate_by_key = _rows_by_key(candidate_df)

    changes = []
    for key in set(running_by_key) | set(candidate_by_key):
        running_row = running_by_key.get(key)
        candidate_row = candidate_by_key.get(key)
        rule_name, vsys = key

        if running_row and not candidate_row:
            changes.append({
                "rule_name": rule_name, "vsys": vsys, "action": "deleted",
                "field_changes": [], "before": running_row, "after": None,
                "change_count": 1,
            })
            continue
        if candidate_row and not running_row:
            changes.append({
                "rule_name": rule_name, "vsys": vsys, "action": "created",
                "field_changes": [], "before": None, "after": candidate_row,
                "change_count": 1,
            })
            continue

        field_changes = []
        for field in DIFF_FIELDS:
            b_val = str(running_row.get(field, "")) if running_row.get(field) is not None else ""
            a_val = str(candidate_row.get(field, "")) if candidate_row.get(field) is not None else ""
            if b_val != a_val:
                field_changes.append({"field": field, "before": b_val, "after": a_val})
        if not field_changes:
            continue
        changes.append({
            "rule_name": rule_name, "vsys": vsys, "action": "updated",
            "field_changes": field_changes, "before": running_row, "after": candidate_row,
            "change_count": len(field_changes),
        })

    order = {"deleted": 0, "updated": 1, "created": 2}
    changes.sort(key=lambda c: (order.get(c["action"], 9), c["rule_name"]))

    summary = {
        "created": sum(1 for c in changes if c["action"] == "created"),
        "updated": sum(1 for c in changes if c["action"] == "updated"),
        "deleted": sum(1 for c in changes if c["action"] == "deleted"),
        "total": len(changes),
    }

    fetched_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return {
        "from_sync": {"id": -1, "sync_at": fetched_at, "total_policies": len(running_by_key)},
        "to_sync": {"id": -2, "sync_at": fetched_at, "total_policies": len(candidate_by_key)},
        "summary": summary,
        "changes": changes,
    }
