"""FAT DB 정책 데이터를 "미사용 NG 정책" 파이프라인용 Excel(bytes)로 변환하는 서비스 로직.

deletion_workflow의 export_service.py와 별개로 유지한다 — 파이프라인 실행 로직은
모듈 간 공통화하지 않는다는 원칙(CLAUDE.md)에 따라, 컬럼 구성이 겹치더라도 이 모듈
전용으로 독립적으로 둔다.
"""
import datetime
import io
from typing import Tuple

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.policy import Policy


class ExportDataError(ValueError):
    """내보낼 데이터가 없을 때 발생합니다 (엔드포인트에서 404로 매핑)."""


async def build_policy_export(
    db: AsyncSession, device, reference_date: datetime.date = None
) -> Tuple[bytes, str]:
    """장비의 활성 정책 전체를 xlsx로 변환합니다 (필터링 없음 — 전량 추출).

    반환: (xlsx bytes, 파일명). 동기화된 정책이 없으면 ExportDataError.
    """
    device_id = device.id

    result = await db.execute(
        select(Policy)
        .filter(Policy.device_id == device_id, Policy.is_active == True)
        .order_by(Policy.vsys, Policy.seq)
    )
    policies = result.scalars().all()
    if not policies:
        raise ExportDataError(
            f"장비 {device.name}에 동기화된 정책 데이터가 없습니다. 먼저 동기화를 실행하세요."
        )

    rows = [{
        "Vsys": p.vsys, "Seq": p.seq, "Rule Name": p.rule_name,
        "Enable": "Y" if p.enable else "N", "Action": p.action, "Source": p.source,
        "User": p.user, "Destination": p.destination, "Service": p.service,
        "Application": p.application, "Security Profile": p.security_profile,
        "Category": p.category, "Description": p.description,
    } for p in policies]

    df = pd.DataFrame(rows)

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="policy", index=False)

    today = reference_date or datetime.date.today()
    filename = f"{today.isoformat()}_{device.ip_address}_policy.xlsx"
    return buf.getvalue(), filename
