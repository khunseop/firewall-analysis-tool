from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func

from typing import List
from app import schemas
from app.models.network_object import NetworkObject
from app.schemas.network_object import NetworkObjectCreate
from datetime import datetime

async def search_network_objects(db: AsyncSession, req: schemas.ObjectSearchRequest) -> List[NetworkObject]:
    stmt = select(NetworkObject).where(
        NetworkObject.is_active == True,
        NetworkObject.device_id.in_(req.device_ids)
    )

    if req.name:
        stmt = stmt.where(NetworkObject.name.ilike(f"%{req.name.strip()}%"))
    if req.ip_address:
        stmt = stmt.where(NetworkObject.ip_address.ilike(f"%{req.ip_address.strip()}%"))
    if req.type:
        stmt = stmt.where(NetworkObject.type.ilike(f"%{req.type.strip()}%"))
    if req.description:
        stmt = stmt.where(NetworkObject.description.ilike(f"%{req.description.strip()}%"))

    stmt = stmt.order_by(NetworkObject.device_id.asc(), NetworkObject.name.asc())

    result = await db.execute(stmt)
    return result.scalars().all()

async def get_network_object_by_name_and_device(db: AsyncSession, device_id: int, name: str):
    result = await db.execute(
        select(NetworkObject).filter(NetworkObject.device_id == device_id, NetworkObject.name == name)
    )
    return result.scalars().first()

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


async def count_network_objects_by_device(db: AsyncSession, device_id: int) -> int:
    """장비별 네트워크 객체 수량을 카운트합니다."""
    result = await db.execute(
        select(func.count(NetworkObject.id)).where(
            NetworkObject.device_id == device_id,
            NetworkObject.is_active == True
        )
    )
    return result.scalar() or 0
