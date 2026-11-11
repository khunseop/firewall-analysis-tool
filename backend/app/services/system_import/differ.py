"""매칭된 FAT 장비와 대시보드 행의 차이를 계산한다 (DB 쓰기 없음)."""
import ipaddress
import re
from datetime import date
from typing import Optional

from app.schemas.system_import import DashboardRow, DeviceDiff, FieldChange, Mismatch
from app.services.system_import.ha_pairing import HaInfo
from app.services.system_import.matcher import Match
from app.services.system_import.vendor_map import map_vendor

_DATE_RE = re.compile(r"^\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})")

# 대시보드 값이 기준: (FAT 필드, 대시보드 컬럼, 변경 종류, 적용 시 설정할 *_manual 값)
_OVERRIDE_FIELDS = (
    ("hostname", "hostname", "override", True),
    ("ip_address", "ip", "connection", None),
)

# FAT 수집값이 기준(비어 있을 때만 채움): (FAT 필드, 대시보드 컬럼, 수기 고정 플래그 필드)
_FILL_FIELDS = (
    ("model", "model", "model_manual"),
    ("serial_number", "serial", "serial_number_manual"),
    ("os_name", "os_name", None),
    ("os_version", "os_version", "os_version_manual"),
    ("install_date", "os_install_date", None),
    ("location_region", "region", None),
    ("location_building", "building", None),
    ("location_floor", "floor", None),
    ("location_room", "room", None),
    ("location_x", "coord_x", None),
    ("location_y", "coord_y", None),
    ("location_z", "coord_z", None),
    ("description", "task_name", None),
)


def to_text(value) -> str:
    """비교·기록용 문자열: 없음은 빈 문자열, 날짜는 ISO, 나머지는 앞뒤 공백 제거."""
    if value is None:
        return ""
    if isinstance(value, date):
        return value.isoformat()
    return str(value).strip()


def _is_ip(text: str) -> bool:
    """IPv4/IPv6 주소 하나인지. 셀에 여러 IP가 적혀 있거나 설명이 붙은 값은 거부한다."""
    try:
        ipaddress.ip_address(text)
        return True
    except ValueError:
        return False


def _normalize_dashboard_value(fat_field: str, value: Optional[str]) -> str:
    """대시보드 값을 FAT 필드 형식의 문자열로 바꾼다. 해석할 수 없으면 빈 문자열."""
    text = to_text(value)
    if fat_field != "install_date" or not text:
        return text
    m = _DATE_RE.match(text)
    if not m:
        return ""
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return ""


def build_diff(match: Match, ha: Optional[HaInfo], partner: Optional[DashboardRow]) -> DeviceDiff:
    device, row = match.device, match.row
    diff = DeviceDiff(
        device_id=device.id, device_name=device.name, via=match.via,
        partner_hostname=ha.partner_hostname if ha and ha.kind == "paired" else None,
        dashboard_retired="폐기" in to_text(row.status),
    )

    # 1) 대시보드 기준 필드 + 벤더
    pairs = [(f, to_text(getattr(row, col)), kind, manual) for f, col, kind, manual in _OVERRIDE_FIELDS]
    mapped_vendor = map_vendor(row.vendor, row.model)
    pairs.append(("vendor", mapped_vendor or "", "connection", None))
    # SECUI 행의 모델이 비어 있으면 ngf/mf2를 구분할 수 없다 — 이미 ngf/mf2로 등록된 장비는 바꾸지 않는다
    if mapped_vendor == "mf2" and not to_text(row.model) and to_text(getattr(device, "vendor", None)) in ("ngf", "mf2"):
        pairs = [p for p in pairs if p[0] != "vendor"]
    for fat_field, new, kind, manual in pairs:
        old = to_text(getattr(device, fat_field, None))
        if new and fat_field == "ip_address" and not _is_ip(new):
            # 접속 대상을 깨진 값으로 바꾸지 않고, 원인을 볼 수 있게 불일치로만 보여준다
            diff.mismatches.append(Mismatch(device_id=device.id, field=fat_field, fat_value=old, dashboard_value=new))
            continue
        if new and new != old:
            diff.changes.append(FieldChange(device_id=device.id, field=fat_field, old=old or None, new=new, kind=kind, set_manual=manual))

    # 2) FAT 수집값 기준 필드: 비어 있을 때만 채우고, 값이 있으면 다를 때 불일치로만 보여준다
    for fat_field, col, flag in _FILL_FIELDS:
        new = _normalize_dashboard_value(fat_field, getattr(row, col))
        if not new:
            continue
        old = to_text(getattr(device, fat_field, None))
        if not old:
            if flag and getattr(device, flag, False):
                continue  # 수기로 고정된 필드는 건드리지 않는다
            diff.changes.append(FieldChange(device_id=device.id, field=fat_field, old=None, new=new, kind="fill"))
        elif old != new:
            diff.mismatches.append(Mismatch(device_id=device.id, field=fat_field, fat_value=old, dashboard_value=new))

    # 3) HA 상대 장비 IP
    fat_peer = to_text(getattr(device, "ha_peer_ip", None))
    if ha and ha.kind == "paired" and partner is not None and to_text(partner.ip):
        partner_ip = to_text(partner.ip)
        if not _is_ip(partner_ip):
            diff.mismatches.append(Mismatch(device_id=device.id, field="ha_peer_ip", fat_value=fat_peer, dashboard_value=partner_ip))
        elif not fat_peer:
            # ha_peer_ip는 동기화가 이 장비의 계정으로 실제 접속하는 대상이라 연결 정보로 취급한다
            diff.changes.append(FieldChange(device_id=device.id, field="ha_peer_ip", old=None, new=partner_ip, kind="connection"))
        elif fat_peer != partner_ip:
            diff.mismatches.append(Mismatch(device_id=device.id, field="ha_peer_ip", fat_value=fat_peer, dashboard_value=partner_ip))
    elif ha and ha.kind == "single" and fat_peer:
        diff.mismatches.append(Mismatch(device_id=device.id, field="ha_peer_ip", fat_value=fat_peer, dashboard_value="(단독 장비)"))
    return diff
