"""시스템 현황 가져오기: 미리보기 계산(DB 쓰기 없음)과 선택 항목 적용·되돌리기."""
import ipaddress
from datetime import date
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.models.device import Device
from app.schemas.system_import import (
    ApplyRequest, ApplyResult, FieldChange, SystemImportPreview, UnmatchedDevice, UnmatchedRow,
)
from app.services.audit_log import log_activity
from app.services.system_import.client import fetch_assets
from app.services.system_import.differ import build_diff, to_text
from app.services.system_import.ha_pairing import classify_ha
from app.services.system_import.matcher import match_devices
from app.services.system_import.vendor_map import map_vendor


def _host(value: Optional[str]) -> str:
    return (value or "").strip().lower()


async def build_preview(
    db: AsyncSession, base_url: str, *, transport: Optional[httpx.AsyncBaseTransport] = None
) -> SystemImportPreview:
    """대시보드를 읽어 FAT 장비와의 차이를 계산한다. 읽기 실패는 DashboardFetchError로 전파된다."""
    rows = await fetch_assets(base_url, transport=transport)
    targets = [r for r in rows if map_vendor(r.vendor, r.model)]
    devices = await crud.device.get_devices(db)

    # 폐기 행은 HA 짝 후보에서 뺀다 (운영 장비에 폐기 장비의 IP를 상대로 제안하지 않기 위해)
    ha = classify_ha([r for r in targets if "폐기" not in (r.status or "")])
    matched = match_devices(devices, targets)
    by_host = {_host(r.hostname): r for r in targets if _host(r.hostname)}

    preview = SystemImportPreview(skipped_vendor_count=len(rows) - len(targets), warnings=list(matched.warnings))
    partner_hosts: set[str] = set()
    matched_rows = {id(m.row) for m in matched.matches}
    for m in matched.matches:
        info = ha.get(_host(m.row.hostname))
        partner = by_host.get(_host(info.partner_hostname)) if info and info.kind == "paired" else None
        if partner is not None:
            partner_hosts.add(_host(info.partner_hostname))
        # 짝이 없다는 경고는 FAT이 HA로 등록한 장비이거나 이름 규칙이 모호할 때만 의미가 있다.
        # 단독 장비에 흔한 `-01`/`-02` 이름까지 경고하면 경고가 소음이 된다.
        if info and (info.kind == "ambiguous" or (info.kind == "orphan" and (getattr(m.device, "ha_peer_ip", None) or "").strip())):
            reason = "짝이 되는 장비를 찾지 못했습니다" if info.kind == "orphan" else "같은 이름 규칙의 장비가 3대 이상이라 짝을 정할 수 없습니다"
            preview.warnings.append(f"대시보드 hostname '{m.row.hostname}': {reason} (HA 여부 확인 필요).")
        diff = build_diff(m, info, partner)
        if partner is not None and id(partner) in matched_rows:
            # 짝으로 보이는 상대도 FAT에 별도 장비로 등록돼 있다면 HA 쌍이 아니라는 신호다 (FAT은 HA 한 쌍을 1건으로 관리)
            diff.changes = [c for c in diff.changes if c.field != "ha_peer_ip"]
            diff.partner_hostname = None
            preview.warnings.append(
                f"장비 '{m.device.name}'과 HA 짝으로 보이는 대시보드 행('{partner.hostname}')이 FAT에 별도 장비로 등록돼 있어 HA Peer IP를 제안하지 않았습니다."
            )
        if diff.dashboard_retired:
            preview.warnings.append(f"장비 '{m.device.name}'은(는) 대시보드에서 폐기 상태입니다.")
        preview.diffs.append(diff)

    preview.unmatched_devices = [UnmatchedDevice(id=d.id, name=d.name, ip_address=d.ip_address) for d in matched.unmatched_devices]
    preview.unmatched_rows = [
        UnmatchedRow(hostname=r.hostname, ip=r.ip, vendor=r.vendor, model=r.model)
        for r in matched.unmatched_rows
        if "폐기" not in (r.status or "") and _host(r.hostname) not in partner_hosts
    ]
    return preview


# ───────────────────────── 적용 / 되돌리기 ─────────────────────────

# 요청으로 바꿀 수 있는 FAT 장비 필드 → 수기 고정 플래그 필드(없으면 None). 이 밖의 필드는 거부한다.
_ALLOWED_FIELDS: dict[str, Optional[str]] = {
    "hostname": "hostname_manual", "ip_address": None, "vendor": None,
    "model": "model_manual", "serial_number": "serial_number_manual",
    "os_name": None, "os_version": "os_version_manual", "install_date": None,
    "location_region": None, "location_building": None, "location_floor": None, "location_room": None,
    "location_x": None, "location_y": None, "location_z": None,
    "description": None, "ha_peer_ip": None,
}
_VENDORS = frozenset({"paloalto", "ngf", "mf2", "mock"})
_IN_CHUNK = 800  # SQLite IN 절 바인딩 청킹 단위
_LOG_DETAIL_MAX = 6000  # 감사 로그 메시지에 남길 변경 상세의 최대 길이


class ConfirmationRequired(Exception):
    """IP·벤더 같은 연결 정보 변경이 포함됐는데 사용자 확인이 없을 때."""


def _parse_value(field: str, new: Optional[str]):
    """요청의 새 값을 DB 값으로 바꾼다. 비어 있으면 None(값 비움). 해석할 수 없으면 ValueError."""
    text = (new or "").strip()
    if not text:
        return None
    if field == "install_date":
        return date.fromisoformat(text)
    if field == "vendor" and text not in _VENDORS:
        raise ValueError(f"지원하지 않는 벤더: {text}")
    if field in ("ip_address", "ha_peer_ip"):
        ipaddress.ip_address(text)  # 형식이 깨진 값은 ValueError → 제외
    return text


async def apply_changes(db: AsyncSession, req: ApplyRequest, *, user_id: int, username: str) -> ApplyResult:
    """선택된 변경만 적용한다. 미리보기 이후 값이 바뀐 항목은 건너뛰고(충돌), 한 번의 commit으로 반영한다."""
    if any(c.kind == "connection" for c in req.changes) and not req.confirm_connection:
        raise ConfirmationRequired("연결 정보(IP·벤더) 변경은 확인이 필요합니다.")

    ids = sorted({c.device_id for c in req.changes})
    devices: dict[int, Device] = {}
    for i in range(0, len(ids), _IN_CHUNK):
        rows = await db.execute(select(Device).where(Device.id.in_(ids[i:i + _IN_CHUNK])))
        devices.update({d.id: d for d in rows.scalars()})

    result = ApplyResult()
    claimed_ips: dict[str, int] = {}  # 이번 요청에서 새로 차지한 IP → 장비 id
    for change in req.changes:
        device = devices.get(change.device_id)
        flag = _ALLOWED_FIELDS.get(change.field)
        if device is None or change.field not in _ALLOWED_FIELDS or (change.set_manual is not None and flag is None):
            result.skipped_invalid.append(change)
            continue
        if to_text(getattr(device, change.field)) != to_text(change.old):
            result.skipped_conflicts.append(change)
            continue
        try:
            value = _parse_value(change.field, change.new)
        except ValueError:
            result.skipped_invalid.append(change)
            continue
        if change.field == "ip_address":
            if value is None:
                result.skipped_invalid.append(change)
                continue
            owner = (await db.execute(select(Device.id).where(Device.ip_address == value, Device.id != device.id))).scalar()
            if owner is not None or claimed_ips.get(value, device.id) != device.id:
                result.skipped_invalid.append(change)
                continue
            claimed_ips[value] = device.id

        previous_flag = getattr(device, flag) if flag and change.set_manual is not None else None
        setattr(device, change.field, value)
        if flag and change.set_manual is not None:
            setattr(device, flag, change.set_manual)
        result.applied.append(change)
        result.reverse.append(FieldChange(
            device_id=change.device_id, field=change.field, old=change.new, new=change.old,
            kind=change.kind, set_manual=previous_flag,
        ))

    if result.applied:
        await db.commit()
        result.reverse.reverse()  # 같은 필드를 여러 번 바꿨다면 적용의 역순으로 풀어야 한다
        # 창을 닫으면 되돌리기 정보가 사라지므로, 감사 로그가 복구의 마지막 근거가 되도록 필드·이전 값·새 값을 남긴다
        details = "; ".join(
            f"{devices[c.device_id].name}.{c.field}: {c.old or '(없음)'}→{c.new or '(비움)'}" for c in result.applied
        )
        if len(details) > _LOG_DETAIL_MAX:
            details = details[:_LOG_DETAIL_MAX] + "…(이하 생략)"
        await log_activity(
            db, title="시스템 현황 가져오기 적용",
            message=f"{len(result.applied)}개 항목 적용 (충돌 {len(result.skipped_conflicts)}건, 제외 {len(result.skipped_invalid)}건) — {details}",
            type="success", category="device", user_id=user_id, username=username,
        )
    return result
