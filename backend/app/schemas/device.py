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
    collect_last_hit_date: Optional[bool] = True
    model: Optional[str] = None
    group: Optional[str] = None

# Schema for creating a new device
class DeviceCreate(DeviceBase):
    password: str
    password_confirm: str

# Schema for updating an existing device (모든 필드 optional — PATCH 스타일 부분 업데이트 지원)
class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None
    vendor: Optional[str] = None
    username: Optional[str] = None
    description: Optional[str] = None
    ha_peer_ip: Optional[str] = None
    use_ssh_for_last_hit_date: Optional[bool] = None
    collect_last_hit_date: Optional[bool] = None
    model: Optional[str] = None
    group: Optional[str] = None
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
    network_groups: int = 0
    services: int = 0
    service_groups: int = 0
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
    total_network_groups: int
    total_services: int
    total_service_groups: int
    device_stats: list[DeviceStats]
