"""
분석 엔진들이 공유하는 공용 조회 헬퍼.
"""

import logging
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Policy

logger = logging.getLogger(__name__)


async def load_active_policies_with_members(db: AsyncSession, device_id: int) -> List[Policy]:
    """
    활성화된(enable=True) 정책들을 순서(seq)대로 정렬하여 조회합니다.
    연관된 address_members와 service_members를 즉시 로딩(selectinload)합니다.
    """
    stmt = (
        select(Policy)
        .where(
            Policy.device_id == device_id,
            Policy.enable == True
        )
        .options(
            selectinload(Policy.address_members),
            selectinload(Policy.service_members)
        )
        .order_by(Policy.seq)
    )
    result = await db.execute(stmt)
    policies = result.scalars().all()
    logger.info(f"장비 {device_id}의 활성 정책 {len(policies)}개를 조회했습니다.")
    return policies
