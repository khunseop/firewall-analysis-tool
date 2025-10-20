from pydantic import BaseModel
from typing import Optional

# Base schema for policy attributes
class PolicyBase(BaseModel):
    rule_name: str
    source_ip: str
    destination_ip: str
    service: str
    action: str
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
