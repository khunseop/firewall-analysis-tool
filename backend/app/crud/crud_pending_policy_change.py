from typing import List, Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pending_policy_change import PendingPolicyChange
from app.schemas.pending_policy_change import PendingPolicyChangeCreate

"""
PendingPolicyChange 모델에 대한 CRUD 연산.
"""


async def get_by_device(db: AsyncSession, device_id: int) -> List[PendingPolicyChange]:
    result = await db.execute(
        select(PendingPolicyChange)
        .where(PendingPolicyChange.device_id == device_id)
        .order_by(PendingPolicyChange.id)
    )
    return list(result.scalars().all())


async def create(db: AsyncSession, device_id: int, obj_in: PendingPolicyChangeCreate, user_id: Optional[int]) -> PendingPolicyChange:
    db_obj = PendingPolicyChange(
        device_id=device_id,
        change_type=obj_in.change_type,
        target_policy_id=obj_in.target_policy_id,
        client_key=obj_in.client_key,
        payload=obj_in.payload,
        created_by_user_id=user_id,
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def get_by_id(db: AsyncSession, change_id: int) -> Optional[PendingPolicyChange]:
    result = await db.execute(select(PendingPolicyChange).where(PendingPolicyChange.id == change_id))
    return result.scalars().first()


async def update_payload(db: AsyncSession, db_obj: PendingPolicyChange, payload: dict) -> PendingPolicyChange:
    """기존 payload에 새 값을 merge한다(부분 갱신)."""
    db_obj.payload = {**db_obj.payload, **payload}
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def delete_by_id(db: AsyncSession, db_obj: PendingPolicyChange) -> None:
    await db.delete(db_obj)
    await db.commit()


async def clear_by_device(db: AsyncSession, device_id: int) -> None:
    await db.execute(delete(PendingPolicyChange).where(PendingPolicyChange.device_id == device_id))
    await db.commit()
