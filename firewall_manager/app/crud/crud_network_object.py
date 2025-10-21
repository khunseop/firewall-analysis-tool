from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update

from app.models.network_object import NetworkObject
from app.schemas.network_object import NetworkObjectCreate
from datetime import datetime

async def get_network_object(db: AsyncSession, network_object_id: int):
    result = await db.execute(select(NetworkObject).filter(NetworkObject.id == network_object_id))
    return result.scalars().first()

async def get_network_objects_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    stmt = select(NetworkObject).filter(NetworkObject.device_id == device_id, NetworkObject.is_active == True).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def get_all_active_network_objects_by_device(db: AsyncSession, device_id: int):
    result = await db.execute(select(NetworkObject).filter(NetworkObject.device_id == device_id, NetworkObject.is_active == True))
    return result.scalars().all()

async def create_network_objects(db: AsyncSession, network_objects: list[NetworkObjectCreate]):
    db_network_objects = [NetworkObject(**obj.model_dump()) for obj in network_objects]
    db.add_all(db_network_objects)
    await db.commit()
    return db_network_objects

async def update_network_object(db: AsyncSession, network_object: NetworkObject, network_object_in: NetworkObjectCreate):
    network_object_data = network_object_in.model_dump(exclude_unset=True)
    for key, value in network_object_data.items():
        setattr(network_object, key, value)
    network_object.is_active = True
    network_object.last_seen_at = datetime.utcnow()
    db.add(network_object)
    await db.commit()
    await db.refresh(network_object)
    return network_object

async def mark_network_objects_as_inactive(db: AsyncSession, device_id: int, network_object_ids_to_keep: set[int]):
    await db.execute(
        update(NetworkObject)
        .where(NetworkObject.device_id == device_id, NetworkObject.is_active == True, NetworkObject.id.notin_(network_object_ids_to_keep))
        .values(is_active=False)
    )
    await db.commit()

async def delete_network_objects_by_device(db: AsyncSession, device_id: int):
    await db.execute(delete(NetworkObject).where(NetworkObject.device_id == device_id))
    await db.commit()
