from pydantic import BaseModel
from typing import Optional

# Base schema for network object attributes
class NetworkObjectBase(BaseModel):
    name: str
    ip_address: str
    type: Optional[str] = None
    description: Optional[str] = None

# Schema for creating a new network object
class NetworkObjectCreate(NetworkObjectBase):
    device_id: int

# Schema for reading network object data (from DB)
class NetworkObject(NetworkObjectBase):
    id: int
    device_id: int

    class Config:
        from_attributes = True
