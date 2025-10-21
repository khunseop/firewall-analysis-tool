from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete

from app.models.network_group import NetworkGroup
from app.schemas.network_group import NetworkGroupCreate

async def get_network_group(db: AsyncSession, network_group_id: int):
    result = await db.execute(select(NetworkGroup).filter(NetworkGroup.id == network_group_id))
    return result.scalars().first()

async def get_network_groups_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    stmt = select(NetworkGroup).filter(NetworkGroup.device_id == device_id).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def create_network_groups(db: AsyncSession, network_groups: list[NetworkGroupCreate]):
    db_network_groups = [NetworkGroup(**obj.model_dump()) for obj in network_groups]
    db.add_all(db_network_groups)
    await db.commit()
    return db_network_groups

async def delete_network_groups_by_device(db: AsyncSession, device_id: int):
    await db.execute(delete(NetworkGroup).where(NetworkGroup.device_id == device_id))
    await db.commit()
