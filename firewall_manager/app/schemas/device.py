from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# Base schema for device attributes
class DeviceBase(BaseModel):
    name: str
    ip_address: str
    vendor: str
    username: str
    description: Optional[str] = None
    ha_peer_ip: Optional[str] = None
    use_ssh_for_last_hit_date: Optional[bool] = False

# Schema for creating a new device
class DeviceCreate(DeviceBase):
    password: str
    password_confirm: str

# Schema for updating an existing device
class DeviceUpdate(DeviceBase):
    password: Optional[str] = None
    password_confirm: Optional[str] = None

# Schema for reading device data (from DB)
class Device(DeviceBase):
    id: int
    last_sync_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None
    last_sync_step: Optional[str] = None

    class Config:
        from_attributes = True

class DeviceSyncStatus(BaseModel):
    last_sync_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None
    last_sync_step: Optional[str] = None

    class Config:
        from_attributes = True


class DeviceStats(BaseModel):
    """장비별 통계 정보"""
    id: int
    name: str
    vendor: str
    ip_address: str
    policies: int = 0
    active_policies: int = 0
    disabled_policies: int = 0
    network_objects: int = 0
    services: int = 0
    sync_status: Optional[str] = None
    sync_step: Optional[str] = None
    sync_time: Optional[datetime] = None


class DashboardStatsResponse(BaseModel):
    """대시보드 통계 응답"""
    total_devices: int
    active_devices: int
    total_policies: int
    total_active_policies: int
    total_disabled_policies: int
    total_network_objects: int
    total_services: int
    device_stats: list[DeviceStats]
