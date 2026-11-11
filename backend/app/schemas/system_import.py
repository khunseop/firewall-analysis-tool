"""시스템 현황 대시보드 → FAT 장비 정보 가져오기: 요청·응답·내부 모델."""
from typing import Literal, Optional

from pydantic import BaseModel


class DashboardRow(BaseModel):
    """대시보드 `/api/assets` 한 행에서 쓰는 컬럼만 담은 모델 (값은 모두 문자열 또는 없음)."""
    hostname: Optional[str] = None
    ip: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    status: Optional[str] = None
    task_name: Optional[str] = None
    serial: Optional[str] = None
    os_install_date: Optional[str] = None
    os_name: Optional[str] = None
    os_version: Optional[str] = None
    region: Optional[str] = None
    building: Optional[str] = None
    floor: Optional[str] = None
    room: Optional[str] = None
    coord_x: Optional[str] = None
    coord_y: Optional[str] = None
    coord_z: Optional[str] = None


ChangeKind = Literal["override", "fill", "connection"]


class FieldChange(BaseModel):
    """FAT 장비 한 필드의 변경 한 건. `set_manual`은 `<field>_manual` 플래그를 이 값으로 설정(None이면 미변경)."""
    device_id: int
    field: str
    old: Optional[str] = None
    new: Optional[str] = None
    kind: ChangeKind
    set_manual: Optional[bool] = None


class Mismatch(BaseModel):
    """FAT 수집값과 대시보드 값이 달라 적용하지 않고 보여주기만 하는 항목."""
    device_id: int
    field: str
    fat_value: str
    dashboard_value: str


class DeviceDiff(BaseModel):
    device_id: int
    device_name: str
    via: Literal["ip", "hostname"]
    changes: list[FieldChange] = []
    mismatches: list[Mismatch] = []
    partner_hostname: Optional[str] = None
    dashboard_retired: bool = False


class UnmatchedDevice(BaseModel):
    id: int
    name: str
    ip_address: str


class UnmatchedRow(BaseModel):
    hostname: Optional[str] = None
    ip: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None


class SystemImportPreview(BaseModel):
    diffs: list[DeviceDiff] = []
    unmatched_devices: list[UnmatchedDevice] = []
    unmatched_rows: list[UnmatchedRow] = []
    skipped_vendor_count: int = 0
    warnings: list[str] = []


class PreviewRequest(BaseModel):
    base_url: Optional[str] = None


class ApplyRequest(BaseModel):
    changes: list[FieldChange]
    confirm_connection: bool = False


class ApplyResult(BaseModel):
    applied: list[FieldChange] = []
    skipped_conflicts: list[FieldChange] = []
    skipped_invalid: list[FieldChange] = []
    reverse: list[FieldChange] = []
