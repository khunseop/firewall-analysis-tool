from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import base
from app.models.network_group import NetworkGroup
from app.schemas.network_group import NetworkGroupCreate

"""
NetworkGroup 모델에 대한 CRUD 연산. 공통 패턴은 crud.base로 위임합니다.
"""

async def get_network_group_by_name_and_device(db: AsyncSession, device_id: int, name: str):
    return await base.get_by_name_and_device(db, NetworkGroup, device_id, name)

async def get_network_group(db: AsyncSession, network_group_id: int):
    return await base.get_by_id(db, NetworkGroup, network_group_id)

async def get_network_groups_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    return await base.get_by_device(db, NetworkGroup, device_id, skip=skip, limit=limit)

async def get_all_active_network_groups_by_device(db: AsyncSession, device_id: int):
    return await base.get_all_active_by_device(db, NetworkGroup, device_id)

async def create_network_groups(db: AsyncSession, network_groups: list[NetworkGroupCreate]):
    return await base.create_many(db, NetworkGroup, network_groups)

async def update_network_group(db: AsyncSession, db_obj: NetworkGroup, obj_in: NetworkGroupCreate):
    return await base.update_obj(db, db_obj, obj_in)

async def delete_network_group(db: AsyncSession, network_group: NetworkGroup):
    return await base.delete_obj(db, network_group)

async def count_network_groups_by_device(db: AsyncSession, device_id: int) -> int:
    return await base.count_by_device(db, NetworkGroup, device_id)

async def search_network_groups(db: AsyncSession, device_ids: list[int], names: list[str] = None,
                                 members: str = None, description: str = None,
                                 skip: int = 0, limit: int | None = None):
    """네트워크 그룹 검색"""
    return await base.search_groups(db, NetworkGroup, device_ids, names=names,
                                    members=members, description=description, skip=skip, limit=limit)
