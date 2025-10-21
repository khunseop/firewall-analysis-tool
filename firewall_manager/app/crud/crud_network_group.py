from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update

from app.models.network_group import NetworkGroup
from app.schemas.network_group import NetworkGroupCreate
from datetime import datetime

async def get_network_group(db: AsyncSession, network_group_id: int):
    result = await db.execute(select(NetworkGroup).filter(NetworkGroup.id == network_group_id))
    return result.scalars().first()

async def get_network_groups_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    stmt = select(NetworkGroup).filter(NetworkGroup.device_id == device_id, NetworkGroup.is_active == True).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def get_all_active_network_groups_by_device(db: AsyncSession, device_id: int):
    result = await db.execute(select(NetworkGroup).filter(NetworkGroup.device_id == device_id, NetworkGroup.is_active == True))
    return result.scalars().all()

async def create_network_groups(db: AsyncSession, network_groups: list[NetworkGroupCreate]):
    db_network_groups = [NetworkGroup(**obj.model_dump()) for obj in network_groups]
    db.add_all(db_network_groups)
    await db.commit()
    return db_network_groups

async def update_network_group(db: AsyncSession, network_group: NetworkGroup, network_group_in: NetworkGroupCreate):
    network_group_data = network_group_in.model_dump(exclude_unset=True)
    for key, value in network_group_data.items():
        setattr(network_group, key, value)
    network_group.is_active = True
    network_group.last_seen_at = datetime.utcnow()
    db.add(network_group)
    await db.commit()
    await db.refresh(network_group)
    return network_group

async def mark_network_groups_as_inactive(db: AsyncSession, device_id: int, network_group_ids_to_keep: set[int]):
    await db.execute(
        update(NetworkGroup)
        .where(NetworkGroup.device_id == device_id, NetworkGroup.is_active == True, NetworkGroup.id.notin_(network_group_ids_to_keep))
        .values(is_active=False)
    )
    await db.commit()

async def delete_network_groups_by_device(db: AsyncSession, device_id: int):
    await db.execute(delete(NetworkGroup).where(NetworkGroup.device_id == device_id))
    await db.commit()
