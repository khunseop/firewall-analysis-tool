from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date

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

    # 상세 정보
    serial_number: Optional[str] = None
    os_name: Optional[str] = None
    os_version: Optional[str] = None
    install_date: Optional[date] = None

    # 설치 위치
    location_region: Optional[str] = None
    location_building: Optional[str] = None
    location_floor: Optional[str] = None
    location_room: Optional[str] = None
    location_x: Optional[str] = None
    location_y: Optional[str] = None
    location_z: Optional[str] = None

    # 객체 수 임계치 (수기 입력, 사용량은 cached_* 컬럼과 비교)
    policy_threshold: Optional[int] = None
    network_object_threshold: Optional[int] = None
    service_threshold: Optional[int] = None

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

    serial_number: Optional[str] = None
    os_name: Optional[str] = None
    os_version: Optional[str] = None
    install_date: Optional[date] = None

    location_region: Optional[str] = None
    location_building: Optional[str] = None
    location_floor: Optional[str] = None
    location_room: Optional[str] = None
    location_x: Optional[str] = None
    location_y: Optional[str] = None
    location_z: Optional[str] = None

    policy_threshold: Optional[int] = None
    network_object_threshold: Optional[int] = None
    service_threshold: Optional[int] = None

# Schema for reading device data (from DB)
class Device(DeviceBase):
    id: int
    last_sync_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None
    last_sync_step: Optional[str] = None

    # 대시보드 통계 캐시 (읽기 전용 — 동기화 완료 시 서버에서 갱신)
    cached_policies: Optional[int] = None
    cached_active_policies: Optional[int] = None
    cached_disabled_policies: Optional[int] = None
    cached_network_objects: Optional[int] = None
    cached_network_groups: Optional[int] = None
    cached_services: Optional[int] = None
    cached_service_groups: Optional[int] = None

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
    policy_threshold: Optional[int] = None
    network_object_threshold: Optional[int] = None
    service_threshold: Optional[int] = None


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
