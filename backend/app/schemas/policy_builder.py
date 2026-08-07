from datetime import datetime
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
    """Policies 편집모드의 '대기중 변경사항'을 모두 모아 CLI를 생성할 때 쓰는 요청. vsys 외에는 DB의
    PendingPolicyChange 레코드에서 읽어온다."""
    vsys: Optional[str] = None


class FieldDiff(BaseModel):
    """그리드 셀 편집 시 원본 값과 편집된 값을 비교해 계산된, 필드 하나의 추가/삭제된 토큰."""
    added: List[str] = []
    removed: List[str] = []


class GeneratedCommand(BaseModel):
    row_index: int
    kind: Literal["object", "policy", "move", "modify", "delete"]
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


class PreviewPolicyRow(BaseModel):
    """편집모드 그리드에 표시할, 대기중 변경사항(생성/수정/삭제/이동)을 모두 적용한 뒤의 정책 1행.

    신규 생성행은 `id`가 음수(-pending_change.id)이며 `seq`/`last_hit_date` 등 DB에서만
    채워지는 필드는 비어 있다."""
    id: int
    device_id: int
    rule_name: str
    action: str = "allow"
    seq: Optional[int] = None
    source: str = ""
    destination: str = ""
    service: str = ""
    application: Optional[str] = None
    from_zone: Optional[str] = None
    to_zone: Optional[str] = None
    user: Optional[str] = None
    description: Optional[str] = None
    log_setting: Optional[str] = None
    enable: Optional[bool] = None
    security_profile: Optional[str] = None
    category: Optional[str] = None
    last_hit_date: Optional[datetime] = None
    hit_count: Optional[int] = None
    is_active: bool = True
    last_seen_at: Optional[datetime] = None
    vsys: Optional[str] = None
    pending_status: Optional[Literal["new", "modified", "deleted", "moved"]] = None


class BulkPolicyPlanResponse(BaseModel):
    missing_objects: List[ObjectGapItem]
    object_commands: List[GeneratedCommand]
    policy_commands: List[GeneratedCommand]
    move_commands: List[GeneratedCommand]
    modify_commands: List[GeneratedCommand] = []
    delete_commands: List[GeneratedCommand] = []
    conflicts: List[InsertionConflict]
    preview_before: List[PreviewRow]
    preview_after: List[PreviewRow]
    warnings: List[str]
