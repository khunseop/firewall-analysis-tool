from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update

from app.models.policy import Policy
from app.schemas.policy import PolicyCreate
from datetime import datetime

async def get_policy(db: AsyncSession, policy_id: int):
    result = await db.execute(select(Policy).filter(Policy.id == policy_id))
    return result.scalars().first()

async def get_policies_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    stmt = select(Policy).filter(Policy.device_id == device_id, Policy.is_active == True).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def get_all_active_policies_by_device(db: AsyncSession, device_id: int):
    result = await db.execute(select(Policy).filter(Policy.device_id == device_id, Policy.is_active == True))
    return result.scalars().all()

async def create_policies(db: AsyncSession, policies: list[PolicyCreate]):
    db_policies = [Policy(**policy.model_dump()) for policy in policies]
    db.add_all(db_policies)
    return db_policies

async def update_policy(db: AsyncSession, db_obj: Policy, obj_in: PolicyCreate):
    obj_data = obj_in.model_dump(exclude_unset=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    return db_obj

async def delete_policy(db: AsyncSession, policy: Policy):
    await db.delete(policy)
    return policy


async def update_policy_last_hit(
    db: AsyncSession,
    device_id: int,
    rule_name: str,
    *,
    vsys: str | None = None,
    last_hit_at: datetime | None = None,
    last_hit_at_secondary: datetime | None = None,
):
    """Update last hit timestamps for a single policy by rule name (and optional vsys)."""
    stmt = update(Policy).where(Policy.device_id == device_id, Policy.rule_name == rule_name)
    if vsys is not None:
        stmt = stmt.where(Policy.vsys == vsys)
    values: dict = {}
    if last_hit_at is not None:
        values['last_hit_at'] = last_hit_at
    if last_hit_at_secondary is not None:
        values['last_hit_at_secondary'] = last_hit_at_secondary
    if not values:
        return 0
    result = await db.execute(stmt.values(**values))
    return result.rowcount or 0
