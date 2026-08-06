"""
신규(가상) 정책들을 지정된 위치(top/bottom/before/after)에 삽입했을 때
기존 활성 정책과 충돌(차단/가림)이 발생하는지 검증하고, 삽입 전/후 배치를 미리보기로 계산합니다.

DB에는 아무 것도 쓰지 않습니다 — `ImpactAnalyzer`(기존 정책 이동)와 달리 삽입 위치가
이미 확정되어 있으므로 "최대 안전 이동 위치"를 계산할 필요가 없고, 그 자리에 놓았을 때
충돌이 있는지/없는지만 판정하면 됩니다.
"""

from typing import List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.analysis import policy_overlap
from app.services.analysis.common import load_active_policies_with_members
from app.schemas.policy_builder import InsertionConflict, MoveTarget, PreviewRow
from app.services.policy_builder.virtual_policy import VirtualPolicy

CONTEXT_RADIUS = 4


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
