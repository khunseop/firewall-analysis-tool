"""비활성(enable=False) 정책이 포함된 장비에서의 삽입 위치 계산/충돌 판정 규칙."""
import asyncio
from types import SimpleNamespace

from app.schemas.policy_builder import MoveTarget
from app.services.policy_builder import insertion_analyzer as ia


def _policy(pid, enable):
    return SimpleNamespace(id=pid, rule_name=f"r{pid}", action="allow", seq=pid, enable=enable)


def _run(monkeypatch, policies, move_target, exclude=None):
    captured = {}

    async def fake_load(db, device_id):
        return policies

    def fake_find_conflicts(real, virtual, index):
        captured["real_ids"] = [p.id for p in real]
        captured["index"] = index
        return []

    monkeypatch.setattr(ia, "load_policies_for_builder", fake_load)
    monkeypatch.setattr(ia, "_find_conflicts", fake_find_conflicts)
    result = asyncio.run(ia.analyze_insertion(None, 1, [], move_target, exclude_policy_ids=exclude))
    return captured, result


def test_disabled_policy_can_be_reference(monkeypatch):
    policies = [_policy(1, True), _policy(2, False), _policy(3, True)]
    captured, (_, preview_before, _, _) = _run(monkeypatch, policies, MoveTarget(position="after", reference_policy_id=2))
    # 비활성 정책(2) 바로 뒤 = 전체 순서 기준 인덱스 2. 충돌 판정은 활성만 보므로 인덱스는 활성 1건 뒤(1).
    assert captured["real_ids"] == [1, 3]
    assert captured["index"] == 1
    # 미리보기에는 비활성 정책도 장비의 실제 순서대로 포함된다.
    assert [r.id for r in preview_before] == [1, 2, 3]


def test_bottom_position_counts_only_enabled_for_conflicts(monkeypatch):
    policies = [_policy(1, True), _policy(2, False), _policy(3, False)]
    captured, _ = _run(monkeypatch, policies, MoveTarget(position="bottom", reference_policy_id=None))
    assert captured["real_ids"] == [1]
    assert captured["index"] == 1


def test_excluded_disabled_policy_is_removed_before_resolving(monkeypatch):
    policies = [_policy(1, True), _policy(2, False), _policy(3, True)]
    captured, _ = _run(monkeypatch, policies, MoveTarget(position="before", reference_policy_id=3), exclude={2})
    assert captured["real_ids"] == [1, 3]
    assert captured["index"] == 1
