from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

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
    rule_name: Optional[str] = None
    action: Optional[str] = None  # exact match if provided
    enable: Optional[bool] = None
    user: Optional[str] = None
    application: Optional[str] = None
    security_profile: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None

    # Date range for last hit
    last_hit_date_from: Optional[datetime] = None
    last_hit_date_to: Optional[datetime] = None

    # Detailed member-index filters
    # Single-value (backward compat)
    src_ip: Optional[str] = None        # IPv4 single/cidr/range/any; falls back to source LIKE
    dst_ip: Optional[str] = None        # IPv4 single/cidr/range/any; falls back to destination LIKE
    protocol: Optional[str] = None      # tcp | udp | any (or None)
    port: Optional[str] = None          # single ('80'), range ('80-90'), any ('any'/'*')
    # Multi-value (OR semantics)
    src_ips: Optional[List[str]] = None
    dst_ips: Optional[List[str]] = None
    services: Optional[List[str]] = None  # tokens like 'tcp/80', '80-90', 'any'

    # Paging (optional; AG-Grid usually client-side). If provided, backend slices.
    skip: Optional[int] = None
    limit: Optional[int] = None

# Response schema for policy search
class PolicySearchResponse(BaseModel):
    policies: List[Policy]
    valid_object_names: List[str]
