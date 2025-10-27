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
    return db_network_objects

async def update_network_object(db: AsyncSession, db_obj: NetworkObject, obj_in: NetworkObjectCreate):
    obj_data = obj_in.model_dump(exclude_unset=True, exclude_none=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    return db_obj

async def delete_network_object(db: AsyncSession, network_object: NetworkObject):
    await db.delete(network_object)
    return network_object
