from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import base
from app.models.service_group import ServiceGroup
from app.schemas.service_group import ServiceGroupCreate

"""
ServiceGroup 모델에 대한 CRUD 연산. 공통 패턴은 crud.base로 위임합니다.
"""

async def get_service_group_by_name_and_device(db: AsyncSession, device_id: int, name: str):
    return await base.get_by_name_and_device(db, ServiceGroup, device_id, name)

async def get_service_group(db: AsyncSession, service_group_id: int):
    return await base.get_by_id(db, ServiceGroup, service_group_id)

async def get_service_groups_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    return await base.get_by_device(db, ServiceGroup, device_id, skip=skip, limit=limit)

async def get_all_active_service_groups_by_device(db: AsyncSession, device_id: int):
    return await base.get_all_active_by_device(db, ServiceGroup, device_id)

async def create_service_groups(db: AsyncSession, service_groups: list[ServiceGroupCreate]):
    return await base.create_many(db, ServiceGroup, service_groups)

async def update_service_group(db: AsyncSession, db_obj: ServiceGroup, obj_in: ServiceGroupCreate):
    return await base.update_obj(db, db_obj, obj_in)

async def delete_service_group(db: AsyncSession, service_group: ServiceGroup):
    return await base.delete_obj(db, service_group)

async def count_service_groups_by_device(db: AsyncSession, device_id: int) -> int:
    return await base.count_by_device(db, ServiceGroup, device_id)

async def search_service_groups(db: AsyncSession, device_ids: list[int], names: list[str] = None,
                                members: str = None, description: str = None,
                                skip: int = 0, limit: int | None = None):
    """서비스 그룹 검색"""
    return await base.search_groups(db, ServiceGroup, device_ids, names=names,
                                    members=members, description=description, skip=skip, limit=limit)
