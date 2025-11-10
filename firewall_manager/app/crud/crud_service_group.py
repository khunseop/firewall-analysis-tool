from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func

from app.models.service_group import ServiceGroup
from app.schemas.service_group import ServiceGroupCreate
from datetime import datetime

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


async def search_service_groups(db: AsyncSession, device_ids: list[int], names: list[str] = None,
                                members: str = None, description: str = None,
                                skip: int = 0, limit: int | None = None):
    """서비스 그룹 검색"""
    from sqlalchemy import or_
    
    stmt = select(ServiceGroup).where(
        ServiceGroup.is_active == True,
        ServiceGroup.device_id.in_(device_ids),
    )
    
    # 이름 필터 (여러 값 OR)
    if names:
        name_conditions = [ServiceGroup.name.ilike(f"%{name.strip()}%") for name in names]
        stmt = stmt.where(or_(*name_conditions))
    
    # 멤버 필터
    if members:
        stmt = stmt.where(ServiceGroup.members.ilike(f"%{members.strip()}%"))
    
    # 설명 필터
    if description:
        stmt = stmt.where(ServiceGroup.description.ilike(f"%{description.strip()}%"))
    
    stmt = stmt.offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    
    result = await db.execute(stmt)
    return result.scalars().all()
