from pydantic import BaseModel
from typing import Optional, List, Union, Literal
from datetime import datetime


# ─── 필터 표현식 트리 ─────────────────────────────────────────────────────────

class FilterLeafNode(BaseModel):
    type: Literal['LEAF']
    field: str
    operator: Literal['contains', 'equals', 'not_equals', 'not_contains', 'gte', 'lte']
    value: str

class FilterGroupNode(BaseModel):
    type: Literal['AND', 'OR']
    children: List['FilterExprNode']

FilterExprNode = Union[FilterLeafNode, FilterGroupNode]
FilterGroupNode.model_rebuild()

# Base schema for policy attributes
class PolicyBase(BaseModel):
    rule_name: str
    source: str
    destination: str
    service: str
    action: str
    vsys: Optional[str] = None
    seq: Optional[int] = None
    enable: Optional[bool] = None
    user: Optional[str] = None
    application: Optional[str] = None
    security_profile: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    last_hit_date: Optional[datetime] = None

# Schema for creating a new policy
class PolicyCreate(PolicyBase):
    device_id: int

# Schema for reading policy data (from DB)
class Policy(PolicyBase):
    id: int
    device_id: int
    is_active: bool
    last_seen_at: datetime

    class Config:
        from_attributes = True


# Request schema for policy search with member-index filters and multi-device
class PolicySearchRequest(BaseModel):
    # Multi-device selection
    device_ids: List[int]

    # Basic policy attribute filters (substring match unless noted)
    vsys: Optional[str] = None
    vsys_negate: bool = False
    rule_name: Optional[str] = None
    rule_name_negate: bool = False
    action: Optional[str] = None  # exact match if provided
    action_negate: bool = False
    enable: Optional[bool] = None
    user: Optional[str] = None
    user_negate: bool = False
    application: Optional[str] = None
    application_negate: bool = False
    security_profile: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    description_negate: bool = False

    # Date range for last hit
    last_hit_date_from: Optional[datetime] = None
    last_hit_date_to: Optional[datetime] = None

    # Detailed member-index filters
    # Single-value (backward compat)
    src_ip: Optional[str] = None        # IPv4 single/cidr/range/any; falls back to source LIKE
    dst_ip: Optional[str] = None        # IPv4 single/cidr/range/any; falls back to destination LIKE
    protocol: Optional[str] = None      # tcp | udp | any (or None)
    port: Optional[str] = None          # single ('80'), range ('80-90'), any ('any'/'*')
    # Multi-value (OR semantics) — IP/port based
    src_ips: Optional[List[str]] = None
    dst_ips: Optional[List[str]] = None
    services: Optional[List[str]] = None  # tokens like 'tcp/80', '80-90', 'any', or service names
    # Object name based (LIKE on PolicyAddressMember.token / PolicyServiceMember.token)
    src_names: Optional[List[str]] = None
    dst_names: Optional[List[str]] = None
    service_names: Optional[List[str]] = None
    # Exact-match IP variants (ip_start == start AND ip_end == end)
    src_ips_exact: Optional[List[str]] = None
    dst_ips_exact: Optional[List[str]] = None
    # Exclude (NOT IN) variants for member-index filters
    src_ips_exclude: Optional[List[str]] = None
    dst_ips_exclude: Optional[List[str]] = None
    services_exclude: Optional[List[str]] = None
    src_names_exclude: Optional[List[str]] = None
    dst_names_exclude: Optional[List[str]] = None
    service_names_exclude: Optional[List[str]] = None
    src_ips_exact_exclude: Optional[List[str]] = None
    dst_ips_exact_exclude: Optional[List[str]] = None
    # 전용 범위 검색: 모든 멤버가 지정 범위 안에 있는 정책만
    src_ips_only_within: Optional[List[str]] = None
    dst_ips_only_within: Optional[List[str]] = None

    # Paging (optional; AG-Grid usually client-side). If provided, backend slices.
    skip: Optional[int] = None
    limit: Optional[int] = None

    # 필터 표현식 트리 (존재하면 flat 필드 대신 이걸 우선 사용)
    filter_expression: Optional[FilterExprNode] = None

# Response schema for policy search
class PolicySearchResponse(BaseModel):
    policies: List[Policy]
    valid_object_names: List[str]


# Response schema for policy count
class PolicyCountResponse(BaseModel):
    total: int
    disabled: int


# Response schema for object count
class ObjectCountResponse(BaseModel):
    network_objects: int  # 객체 + 그룹 합계
    services: int  # 서비스 + 그룹 합계
