from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# Base schema for network group attributes
class NetworkGroupBase(BaseModel):
    name: str
    members: Optional[str] = None
    description: Optional[str] = None

# Schema for creating a new network group
class NetworkGroupCreate(NetworkGroupBase):
    device_id: int

# Schema for reading network group data (from DB)
class NetworkGroup(NetworkGroupBase):
    id: int
    device_id: int

    class Config:
        from_attributes = True
