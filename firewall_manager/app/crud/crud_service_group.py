from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func

from typing import List
from app import schemas
from sqlalchemy import and_
from app.models.service_group import ServiceGroup
from app.schemas.service_group import ServiceGroupCreate
from datetime import datetime

async def search_service_groups(db: AsyncSession, req: schemas.ObjectSearchRequest) -> List[ServiceGroup]:
    stmt = select(ServiceGroup).where(
        ServiceGroup.is_active == True,
        ServiceGroup.device_id.in_(req.device_ids)
    )

    if req.name:
        stmt = stmt.where(ServiceGroup.name.ilike(f"%{req.name.strip()}%"))
    if req.description:
        stmt = stmt.where(ServiceGroup.description.ilike(f"%{req.description.strip()}%"))
    if req.members:
        member_conditions = [
            ServiceGroup.members.ilike(f"%{member.strip()}%")
            for member in req.members.split(',') if member.strip()
        ]
        if member_conditions:
            stmt = stmt.where(and_(*member_conditions))

    stmt = stmt.order_by(ServiceGroup.device_id.asc(), ServiceGroup.name.asc())

    result = await db.execute(stmt)
    return result.scalars().all()

async def get_service_group_by_name_and_device(db: AsyncSession, device_id: int, name: str):
    result = await db.execute(
        select(ServiceGroup).filter(ServiceGroup.device_id == device_id, ServiceGroup.name == name)
    )
    return result.scalars().first()

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
    return db_service_groups

async def update_service_group(db: AsyncSession, db_obj: ServiceGroup, obj_in: ServiceGroupCreate):
    obj_data = obj_in.model_dump(exclude_unset=True, exclude_none=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    return db_obj

async def delete_service_group(db: AsyncSession, service_group: ServiceGroup):
    await db.delete(service_group)
    return service_group


async def count_service_groups_by_device(db: AsyncSession, device_id: int) -> int:
    """장비별 서비스 그룹 수량을 카운트합니다."""
    result = await db.execute(
        select(func.count(ServiceGroup.id)).where(
            ServiceGroup.device_id == device_id,
            ServiceGroup.is_active == True
        )
    )
    return result.scalar() or 0
