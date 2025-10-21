from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update

from app.models.service import Service
from app.schemas.service import ServiceCreate
from datetime import datetime

async def get_service(db: AsyncSession, service_id: int):
    result = await db.execute(select(Service).filter(Service.id == service_id))
    return result.scalars().first()

async def get_services_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    stmt = select(Service).filter(Service.device_id == device_id, Service.is_active == True).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def get_all_active_services_by_device(db: AsyncSession, device_id: int):
    result = await db.execute(select(Service).filter(Service.device_id == device_id, Service.is_active == True))
    return result.scalars().all()

async def create_services(db: AsyncSession, services: list[ServiceCreate]):
    db_services = [Service(**obj.model_dump()) for obj in services]
    db.add_all(db_services)
    await db.commit()
    return db_services

async def update_service(db: AsyncSession, service: Service, service_in: ServiceCreate):
    service_data = service_in.model_dump(exclude_unset=True)
    for key, value in service_data.items():
        setattr(service, key, value)
    service.is_active = True
    service.last_seen_at = datetime.utcnow()
    db.add(service)
    await db.commit()
    await db.refresh(service)
    return service

async def mark_services_as_inactive(db: AsyncSession, device_id: int, service_ids_to_keep: set[int]):
    await db.execute(
        update(Service)
        .where(Service.device_id == device_id, Service.is_active == True, Service.id.notin_(service_ids_to_keep))
        .values(is_active=False)
    )
    await db.commit()

async def delete_services_by_device(db: AsyncSession, device_id: int):
    await db.execute(delete(Service).where(Service.device_id == device_id))
    await db.commit()
