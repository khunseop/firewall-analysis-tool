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
    return db_services

async def update_service(db: AsyncSession, db_obj: Service, obj_in: ServiceCreate):
    obj_data = obj_in.model_dump(exclude_unset=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    return db_obj

async def delete_service(db: AsyncSession, service: Service):
    await db.delete(service)
    return service
