from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# Base schema for device attributes
class DeviceBase(BaseModel):
    name: str
    ip_address: str
    secondary_ip_address: Optional[str] = None
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
    last_sync_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None

    class Config:
        from_attributes = True

class DeviceSyncStatus(BaseModel):
    last_sync_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None

    class Config:
        from_attributes = True
