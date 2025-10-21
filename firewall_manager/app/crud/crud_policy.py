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
    await db.commit()
    return db_policies

async def update_policy(db: AsyncSession, policy: Policy, policy_in: PolicyCreate):
    policy_data = policy_in.model_dump(exclude_unset=True)
    for key, value in policy_data.items():
        setattr(policy, key, value)
    policy.is_active = True
    policy.last_seen_at = datetime.utcnow()
    db.add(policy)
    await db.commit()
    await db.refresh(policy)
    return policy

async def mark_policies_as_inactive(db: AsyncSession, device_id: int, policy_ids_to_keep: set[int]):
    await db.execute(
        update(Policy)
        .where(Policy.device_id == device_id, Policy.is_active == True, Policy.id.notin_(policy_ids_to_keep))
        .values(is_active=False)
    )
    await db.commit()

async def delete_policies_by_device(db: AsyncSession, device_id: int):
    await db.execute(delete(Policy).where(Policy.device_id == device_id))
    await db.commit()
