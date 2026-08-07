"""
신규(가상) 정책들을 지정된 위치(top/bottom/before/after)에 삽입했을 때
기존 활성 정책과 충돌(차단/가림)이 발생하는지 검증하고, 삽입 전/후 배치를 미리보기로 계산합니다.

DB에는 아무 것도 쓰지 않습니다 — `ImpactAnalyzer`(기존 정책 이동)와 달리 삽입 위치가
이미 확정되어 있으므로 "최대 안전 이동 위치"를 계산할 필요가 없고, 그 자리에 놓았을 때
충돌이 있는지/없는지만 판정하면 됩니다.
"""

from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.services.analysis import policy_overlap
from app.services.analysis.common import load_active_policies_with_members
from app.schemas.policy_builder import InsertionConflict, MoveTarget, PreviewRow
from app.services.policy_builder.virtual_policy import VirtualPolicy

CONTEXT_RADIUS = 4

# modify pending change의 payload 키(백엔드 필드명) -> 정책/그리드 표시 필드명.
# frontend PoliciesPage.tsx의 EDITABLE_FIELD_MAP과 반드시 동기화되어야 한다.
_MODIFY_FIELD_MAP = {
    "source": "source", "destination": "destination", "service": "service",
    "application": "application", "source_user": "user",
    "from_zone": "from_zone", "to_zone": "to_zone",
}


def _resolve_insertion_index(real_policies: list, move_target: MoveTarget) -> int:
    if move_target.position == "top":
        return 0
    if move_target.position == "bottom":
        return len(real_policies)

    if move_target.reference_policy_id is None:
        raise ValueError("before/after 위치에는 기준 정책(reference_policy_id)이 필요합니다.")
    idx = next((i for i, p in enumerate(real_policies) if p.id == move_target.reference_policy_id), None)
    if idx is None:
        raise ValueError(f"기준 정책 ID {move_target.reference_policy_id}를 찾을 수 없습니다 (활성 정책 중에 없음).")
    return idx if move_target.position == "before" else idx + 1


def _to_preview_row(policy, is_new: bool = False) -> PreviewRow:
    return PreviewRow(id=policy.id, rule_name=policy.rule_name, action=policy.action, seq=getattr(policy, "seq", None), is_new=is_new)


def _find_conflicts(real_policies: list, virtual_policies: List[VirtualPolicy], insertion_index: int) -> List[InsertionConflict]:
    conflicts: List[InsertionConflict] = []

    for vp in virtual_policies:
        # 위쪽: 삽입 지점에서 가까운 순서로 스캔 — 허용(vp) 정책이 위쪽 거부 정책에 막히는 경우
        for i in range(insertion_index - 1, -1, -1):
            policy = real_policies[i]
            if policy.action == "deny" and vp.action == "allow" and policy_overlap.policies_overlap(vp, policy):
                details = policy_overlap.overlap_details(vp, policy)
                conflicts.append(InsertionConflict(
                    rule_name=vp.rule_name,
                    conflict_type="blocking",
                    conflicting_policy_id=policy.id,
                    conflicting_policy_name=policy.rule_name,
                    reason=(
                        f"신규 허용 정책 '{vp.rule_name}'이 기존 거부 정책 '{policy.rule_name}'(seq {policy.seq}) 뒤에 위치해 "
                        f"차단됩니다. ({policy_overlap.describe_overlap(details)})"
                    ),
                ))
                break

        # 아래쪽: 삽입 지점에서 가까운 순서로 스캔 — 신규 정책이 아래쪽 기존 정책을 가리는 경우
        for i in range(insertion_index, len(real_policies)):
            policy = real_policies[i]
            is_shadowing_case = (
                (vp.action == "deny" and policy.action == "allow")
                or (vp.action == "allow" and policy.action == "allow")
            )
            if is_shadowing_case and policy_overlap.policies_overlap(vp, policy):
                details = policy_overlap.overlap_details(vp, policy)
                conflicts.append(InsertionConflict(
                    rule_name=vp.rule_name,
                    conflict_type="shadowing",
                    conflicting_policy_id=policy.id,
                    conflicting_policy_name=policy.rule_name,
                    reason=(
                        f"신규 정책 '{vp.rule_name}'이 기존 정책 '{policy.rule_name}'(seq {policy.seq})보다 먼저 평가되어 "
                        f"그 효과를 가릴 수 있습니다. ({policy_overlap.describe_overlap(details)})"
                    ),
                ))
                break

    return conflicts


def _build_previews(real_policies: list, virtual_policies: List[VirtualPolicy], insertion_index: int) -> Tuple[List[PreviewRow], List[PreviewRow]]:
    before_lo = max(0, insertion_index - CONTEXT_RADIUS)
    before_hi = min(len(real_policies), insertion_index + CONTEXT_RADIUS)
    preview_before = [_to_preview_row(p) for p in real_policies[before_lo:before_hi]]

    combined = (
        [_to_preview_row(p) for p in real_policies[:insertion_index]]
        + [_to_preview_row(vp, is_new=True) for vp in virtual_policies]
        + [_to_preview_row(p) for p in real_policies[insertion_index:]]
    )
    after_lo = max(0, insertion_index - CONTEXT_RADIUS)
    after_hi = min(len(combined), insertion_index + len(virtual_policies) + CONTEXT_RADIUS)
    preview_after = combined[after_lo:after_hi]

    return preview_before, preview_after


async def analyze_insertion(
    db: AsyncSession,
    device_id: int,
    virtual_policies: List[VirtualPolicy],
    move_target: MoveTarget,
    exclude_policy_ids: Optional[set] = None,
) -> Tuple[List[InsertionConflict], List[PreviewRow], List[PreviewRow], List[str]]:
    """
    삽입 지점 충돌 판정 + 삽입 전/후 미리보기(±4 컨텍스트 윈도우)를 계산합니다.
    reference_policy_id를 찾지 못하면 ValueError를 발생시킵니다(호출부에서 400으로 변환).

    `exclude_policy_ids`: 기존 정책을 "이동"시킬 때, 그 정책 자신을 real_policies에서 제외하기
    위한 용도(자기 자신과의 충돌 오탐 방지, `wrap_existing_policy_as_virtual` 참고).
    """
    real_policies = await load_active_policies_with_members(db, device_id)
    if exclude_policy_ids:
        real_policies = [p for p in real_policies if p.id not in exclude_policy_ids]
    insertion_index = _resolve_insertion_index(real_policies, move_target)

    conflicts = _find_conflicts(real_policies, virtual_policies, insertion_index)
    preview_before, preview_after = _build_previews(real_policies, virtual_policies, insertion_index)

    warnings = [
        "신규 정책끼리는 서로 충돌 여부를 검사하지 않습니다 (입력한 순서를 그대로 신뢰합니다).",
    ]

    return conflicts, preview_before, preview_after, warnings


def _resolve_insertion_index_dict(items: List[Dict[str, Any]], move_target: MoveTarget) -> int:
    """`_resolve_insertion_index`와 동일한 규칙을 dict 리스트(id 키)에 대해 적용한다."""
    if move_target.position == "top":
        return 0
    if move_target.position == "bottom":
        return len(items)
    if move_target.reference_policy_id is None:
        raise ValueError("before/after 위치에는 기준 정책(reference_policy_id)이 필요합니다.")
    idx = next((i for i, it in enumerate(items) if it["id"] == move_target.reference_policy_id), None)
    if idx is None:
        raise ValueError(f"기준 정책 ID {move_target.reference_policy_id}를 찾을 수 없습니다 (활성 정책 중에 없음).")
    return idx if move_target.position == "before" else idx + 1


def _policy_to_item(p) -> Dict[str, Any]:
    return {
        "id": p.id, "device_id": p.device_id, "rule_name": p.rule_name, "action": p.action,
        "seq": p.seq, "source": p.source, "destination": p.destination, "service": p.service,
        "application": p.application, "from_zone": p.from_zone, "to_zone": p.to_zone,
        "user": p.user, "description": p.description, "log_setting": p.log_setting,
        "enable": p.enable, "security_profile": p.security_profile, "category": p.category,
        "last_hit_date": p.last_hit_date, "hit_count": p.hit_count, "is_active": p.is_active,
        "last_seen_at": p.last_seen_at, "vsys": p.vsys, "pending_status": None,
    }


def _create_payload_to_item(change, device_id: int) -> Dict[str, Any]:
    payload = change.payload or {}
    return {
        "id": -change.id, "device_id": device_id,
        "rule_name": payload.get("rule_name", ""), "action": payload.get("rule_action", "allow"),
        "seq": None, "source": payload.get("source", ""), "destination": payload.get("destination", ""),
        "service": payload.get("service", ""), "application": payload.get("application") or None,
        "from_zone": payload.get("from_zone") or None, "to_zone": payload.get("to_zone") or None,
        "user": payload.get("source_user") or None, "description": payload.get("description") or None,
        "log_setting": payload.get("log_setting") or None, "enable": not payload.get("disabled", False),
        "security_profile": None, "category": None, "last_hit_date": None, "hit_count": None,
        "is_active": True, "last_seen_at": None, "pending_status": "new",
    }


def _apply_modify_overlay(item: Dict[str, Any], payload: Dict[str, Any]) -> None:
    for backend_field, diff in (payload or {}).items():
        grid_field = _MODIFY_FIELD_MAP.get(backend_field)
        if grid_field is None:
            continue
        current = str(item.get(grid_field) or "")
        tokens = [t.strip() for t in current.split(",") if t.strip()]
        removed = set((diff or {}).get("removed") or [])
        kept = [t for t in tokens if t not in removed]
        added = [t for t in (diff or {}).get("added") or [] if t not in kept]
        item[grid_field] = ",".join(kept + added)


async def build_full_order(db: AsyncSession, device_id: int) -> List[Dict[str, Any]]:
    """
    Policies 편집모드 그리드에 표시할, 대기중 변경사항(생성/수정/삭제/이동)을 모두 적용한
    최종 정책 순서를 계산한다. `/plan`이 CLI를 생성할 때 쓰는 것과 동일한 위치 계산
    (`_resolve_insertion_index`)을 재사용해 화면과 실제 CLI 생성 결과가 어긋나지 않도록 한다.

    이동은 대기중 변경사항이 만들어진 순서(id순)대로 순차 적용한다 — 기준 정책은 항상 실제
    정책(스키마상 reference_policy_id는 DB에 이미 존재하는 정책만 허용)이므로, 이전 이동으로
    다른 항목의 위치가 바뀌어도 기준 정책 자체의 상대적 위치 계산에는 영향이 없다. 단, `/plan`은
    각 이동을 매번 "원본 조회 결과"에서 독립적으로 계산하는 반면 여기서는 누적된 작업 리스트에
    순차 적용한다는 차이가 있다 — 같은 기준 정책을 향해 여러 건을 동시에 이동하는 드문 경우에만
    화면 표시 순서가 실제 CLI 실행 순서와 미세하게 다를 수 있다.

    신규 생성(create)행은 (기존 `/plan`과 동일하게) 모든 create 변경사항이 하나의 목표 위치를
    공유한다 — 첫 create 변경사항의 position/reference_policy_id를 사용한다.
    """
    real_policies = await load_active_policies_with_members(db, device_id)
    changes = await crud.pending_policy_change.get_by_device(db, device_id)

    items: List[Dict[str, Any]] = [_policy_to_item(p) for p in real_policies]
    by_id = {item["id"]: item for item in items}

    move_changes = [c for c in changes if c.change_type == "move" and c.target_policy_id is not None]
    create_changes = [c for c in changes if c.change_type == "create"]
    modify_changes = [c for c in changes if c.change_type == "modify" and c.target_policy_id is not None]
    delete_ids = {c.target_policy_id for c in changes if c.change_type == "delete" and c.target_policy_id is not None}

    for c in modify_changes:
        item = by_id.get(c.target_policy_id)
        if item is not None:
            _apply_modify_overlay(item, c.payload or {})
            item["pending_status"] = item.get("pending_status") or "modified"

    for policy_id in delete_ids:
        item = by_id.get(policy_id)
        if item is not None:
            item["pending_status"] = "deleted"

    for c in move_changes:
        item = by_id.get(c.target_policy_id)
        if item is None or item["pending_status"] == "deleted":
            continue
        move_target = MoveTarget(
            position=(c.payload or {}).get("position", "bottom"),
            reference_policy_id=(c.payload or {}).get("reference_policy_id"),
        )
        try:
            items.remove(item)
            idx = _resolve_insertion_index_dict(items, move_target)
        except ValueError:
            items.append(item)
            continue
        items.insert(idx, item)
        item["pending_status"] = "moved"

    if create_changes:
        first_payload = create_changes[0].payload or {}
        move_target = MoveTarget(
            position=first_payload.get("position", "bottom"),
            reference_policy_id=first_payload.get("reference_policy_id"),
        )
        try:
            insert_idx = _resolve_insertion_index_dict(items, move_target)
        except ValueError:
            insert_idx = len(items)
        new_items = [_create_payload_to_item(c, device_id) for c in create_changes]
        items[insert_idx:insert_idx] = new_items

    return items
