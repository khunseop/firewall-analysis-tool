from pydantic import BaseModel
from typing import Optional

# Base schema for service group attributes
class ServiceGroupBase(BaseModel):
    name: str
    members: Optional[str] = None
    description: Optional[str] = None

# Schema for creating a new service group
class ServiceGroupCreate(ServiceGroupBase):
    device_id: int

# Schema for reading service group data (from DB)
class ServiceGroup(ServiceGroupBase):
    id: int
    device_id: int

    class Config:
        from_attributes = True
