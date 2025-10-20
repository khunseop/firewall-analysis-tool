from pydantic import BaseModel
from typing import Optional

# Base schema for device attributes
class DeviceBase(BaseModel):
    name: str
    ip_address: str
    vendor: str
    username: str
    description: Optional[str] = None

# Schema for creating a new device
class DeviceCreate(DeviceBase):
    password: str

# Schema for updating an existing device
class DeviceUpdate(DeviceBase):
    password: Optional[str] = None

# Schema for reading device data (from DB)
class Device(DeviceBase):
    id: int

    class Config:
        from_attributes = True
