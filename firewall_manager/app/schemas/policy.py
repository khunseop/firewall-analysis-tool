from pydantic import BaseModel
from typing import Optional
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
    flattened_source: Optional[str] = None
    flattened_destination: Optional[str] = None
    flattened_service: Optional[str] = None

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
