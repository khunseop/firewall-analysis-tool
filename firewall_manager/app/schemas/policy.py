from pydantic import BaseModel
from typing import Optional

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

# Schema for creating a new policy
class PolicyCreate(PolicyBase):
    device_id: int

# Schema for reading policy data (from DB)
class Policy(PolicyBase):
    id: int
    device_id: int

    class Config:
        from_attributes = True
