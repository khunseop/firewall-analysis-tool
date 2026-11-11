"""시스템 현황 가져오기: 미리보기 계산 (DB 쓰기 없음)."""
from typing import Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.schemas.system_import import SystemImportPreview, UnmatchedDevice, UnmatchedRow
from app.services.system_import.client import fetch_assets
from app.services.system_import.differ import build_diff
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

    ha = classify_ha(targets)
    matched = match_devices(devices, targets)
    by_host = {_host(r.hostname): r for r in targets if _host(r.hostname)}

    preview = SystemImportPreview(skipped_vendor_count=len(rows) - len(targets), warnings=list(matched.warnings))
    partner_hosts: set[str] = set()
    for m in matched.matches:
        info = ha.get(_host(m.row.hostname))
        partner = by_host.get(_host(info.partner_hostname)) if info and info.kind == "paired" else None
        if partner is not None:
            partner_hosts.add(_host(info.partner_hostname))
        if info and info.kind in ("orphan", "ambiguous"):
            reason = "짝이 되는 장비를 찾지 못했습니다" if info.kind == "orphan" else "같은 이름 규칙의 장비가 3대 이상이라 짝을 정할 수 없습니다"
            preview.warnings.append(f"대시보드 hostname '{m.row.hostname}': {reason} (HA 여부 확인 필요).")
        preview.diffs.append(build_diff(m, info, partner))

    preview.unmatched_devices = [UnmatchedDevice(id=d.id, name=d.name, ip_address=d.ip_address) for d in matched.unmatched_devices]
    preview.unmatched_rows = [
        UnmatchedRow(hostname=r.hostname, ip=r.ip, vendor=r.vendor, model=r.model)
        for r in matched.unmatched_rows
        if "폐기" not in (r.status or "") and _host(r.hostname) not in partner_hosts
    ]
    return preview
