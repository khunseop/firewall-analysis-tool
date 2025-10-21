from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update

from app.models.service_group import ServiceGroup
from app.schemas.service_group import ServiceGroupCreate
from datetime import datetime

async def get_service_group(db: AsyncSession, service_group_id: int):
    result = await db.execute(select(ServiceGroup).filter(ServiceGroup.id == service_group_id))
    return result.scalars().first()

async def get_service_groups_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    stmt = select(ServiceGroup).filter(ServiceGroup.device_id == device_id, ServiceGroup.is_active == True).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def get_all_active_service_groups_by_device(db: AsyncSession, device_id: int):
    result = await db.execute(select(ServiceGroup).filter(ServiceGroup.device_id == device_id, ServiceGroup.is_active == True))
    return result.scalars().all()

async def create_service_groups(db: AsyncSession, service_groups: list[ServiceGroupCreate]):
    db_service_groups = [ServiceGroup(**obj.model_dump()) for obj in service_groups]
    db.add_all(db_service_groups)
    await db.commit()
    return db_service_groups

async def update_service_group(db: AsyncSession, service_group: ServiceGroup, service_group_in: ServiceGroupCreate):
    service_group_data = service_group_in.model_dump(exclude_unset=True)
    for key, value in service_group_data.items():
        setattr(service_group, key, value)
    service_group.is_active = True
    service_group.last_seen_at = datetime.utcnow()
    db.add(service_group)
    await db.commit()
    await db.refresh(service_group)
    return service_group

async def mark_service_groups_as_inactive(db: AsyncSession, device_id: int, service_group_ids_to_keep: set[int]):
    await db.execute(
        update(ServiceGroup)
        .where(ServiceGroup.device_id == device_id, ServiceGroup.is_active == True, ServiceGroup.id.notin_(service_group_ids_to_keep))
        .values(is_active=False)
    )
    await db.commit()

async def delete_service_groups_by_device(db: AsyncSession, device_id: int):
    await db.execute(delete(ServiceGroup).where(ServiceGroup.device_id == device_id))
    await db.commit()
