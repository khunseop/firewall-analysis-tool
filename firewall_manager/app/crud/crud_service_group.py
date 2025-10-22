from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete

from app.models.service_group import ServiceGroup
from app.schemas.service_group import ServiceGroupCreate

async def get_service_group(db: AsyncSession, service_group_id: int):
    result = await db.execute(select(ServiceGroup).filter(ServiceGroup.id == service_group_id))
    return result.scalars().first()

async def get_service_groups_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    stmt = select(ServiceGroup).filter(ServiceGroup.device_id == device_id).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def create_service_groups(db: AsyncSession, service_groups: list[ServiceGroupCreate]):
    db_service_groups = [ServiceGroup(**obj.model_dump()) for obj in service_groups]
    db.add_all(db_service_groups)
    await db.commit()
    return db_service_groups

async def update_service_group(db: AsyncSession, db_obj: ServiceGroup, obj_in: ServiceGroupCreate):
    obj_data = obj_in.model_dump(exclude_unset=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def delete_service_group(db: AsyncSession, service_group_id: int):
    result = await db.execute(select(ServiceGroup).filter(ServiceGroup.id == service_group_id))
    db_service_group = result.scalars().first()
    if db_service_group:
        await db.delete(db_service_group)
        await db.commit()
    return db_service_group
