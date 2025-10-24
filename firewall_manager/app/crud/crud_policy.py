from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update

from app.models.policy import Policy
from app.schemas.policy import PolicyCreate
from datetime import datetime
from typing import List

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

def _sanitize_seq(value):
    try:
        if value is None:
            return None
        if isinstance(value, (int,)):
            return value
        # handle floats/strings/NaN
        if isinstance(value, float):
            # avoid NaN
            try:
                import math
                if math.isnan(value):
                    return None
            except Exception:
                pass
            return int(value)
        s = str(value).strip()
        if not s or s.lower() in {"nan", "-", "--", "—", "n/a", "na"}:
            return None
        if s.isdigit():
            return int(s)
        return int(float(s))
    except Exception:
        return None


async def create_policies(db: AsyncSession, policies: List[PolicyCreate]):
    sanitized: List[Policy] = []
    for policy in policies:
        data = policy.model_dump()
        data["seq"] = _sanitize_seq(data.get("seq"))
        # ensure device_id is int
        try:
            data["device_id"] = int(data.get("device_id")) if data.get("device_id") is not None else None
        except Exception:
            pass
        sanitized.append(Policy(**data))
    db.add_all(sanitized)
    # flush to detect binding errors early
    await db.flush()
    return sanitized

async def update_policy(db: AsyncSession, db_obj: Policy, obj_in: PolicyCreate):
    obj_data = obj_in.model_dump(exclude_unset=True)
    if "seq" in obj_data:
        obj_data["seq"] = _sanitize_seq(obj_data.get("seq"))
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
