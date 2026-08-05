from typing import Dict, List, Literal, Optional

from pydantic import BaseModel


class NewObjectSpec(BaseModel):
    """사용자가 입력한, 아직 장비에 없는 신규 오브젝트의 실제 값."""
    name: str
    object_kind: Literal["address", "service"]
    address_type: Optional[Literal["ip-mask", "ip-range", "fqdn"]] = None
    ip_address: Optional[str] = None
    protocol: Optional[Literal["tcp", "udp"]] = None
    port: Optional[str] = None
    description: str = ""


class NewPolicyRow(BaseModel):
    """붙여넣기로 입력받은 신규 정책 1건."""
    row_index: int
    rule_name: str
    rule_action: str = "allow"
    disabled: bool = False
    from_zone: str = ""
    source: str = ""
    source_user: str = ""
    to_zone: str = ""
    destination: str = ""
    service: str = ""
    application: str = ""
    description: str = ""
    log_end: str = ""
    log_setting: str = ""


class MoveTarget(BaseModel):
    """신규 정책들을 배치할 목표 위치. reference_policy_id는 DB에 이미 존재하는 정책만 허용."""
    position: Literal["top", "bottom", "before", "after"]
    reference_policy_id: Optional[int] = None


class ObjectGapItem(BaseModel):
    name: str
    object_kind: Literal["address", "service"]
    referenced_by_rule_names: List[str]


class ObjectGapCheckRequest(BaseModel):
    new_policies: List[NewPolicyRow]


class ObjectGapCheckResponse(BaseModel):
    missing_objects: List[ObjectGapItem]


class BulkPolicyPlanRequest(BaseModel):
    vsys: Optional[str] = None
    new_policies: List[NewPolicyRow]
    new_objects: List[NewObjectSpec] = []
    move_target: MoveTarget


class GeneratedCommand(BaseModel):
    row_index: int
    kind: Literal["object", "policy", "move"]
    command: Optional[str] = None
    error: Optional[str] = None
    counts: Optional[Dict[str, int]] = None


class InsertionConflict(BaseModel):
    rule_name: str
    conflict_type: Literal["blocking", "shadowing"]
    conflicting_policy_id: int
    conflicting_policy_name: str
    reason: str


class PreviewRow(BaseModel):
    id: int
    rule_name: str
    action: str
    seq: Optional[int] = None
    is_new: bool = False


class BulkPolicyPlanResponse(BaseModel):
    missing_objects: List[ObjectGapItem]
    object_commands: List[GeneratedCommand]
    policy_commands: List[GeneratedCommand]
    move_commands: List[GeneratedCommand]
    conflicts: List[InsertionConflict]
    preview_before: List[PreviewRow]
    preview_after: List[PreviewRow]
    warnings: List[str]
