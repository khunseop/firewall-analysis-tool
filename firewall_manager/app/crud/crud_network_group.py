from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func

from app.models.network_group import NetworkGroup
from app.schemas.network_group import NetworkGroupCreate
from datetime import datetime

async def get_network_group_by_name_and_device(db: AsyncSession, device_id: int, name: str):
    result = await db.execute(
        select(NetworkGroup).filter(NetworkGroup.device_id == device_id, NetworkGroup.name == name)
    )
    return result.scalars().first()

async def get_network_group(db: AsyncSession, network_group_id: int):
    result = await db.execute(select(NetworkGroup).filter(NetworkGroup.id == network_group_id))
    return result.scalars().first()

async def get_network_groups_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    stmt = select(NetworkGroup).filter(NetworkGroup.device_id == device_id, NetworkGroup.is_active == True).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def get_all_active_network_groups_by_device(db: AsyncSession, device_id: int):
    result = await db.execute(select(NetworkGroup).filter(NetworkGroup.device_id == device_id, NetworkGroup.is_active == True))
    return result.scalars().all()

async def create_network_groups(db: AsyncSession, network_groups: list[NetworkGroupCreate]):
    db_network_groups = [NetworkGroup(**obj.model_dump()) for obj in network_groups]
    db.add_all(db_network_groups)
    return db_network_groups

async def update_network_group(db: AsyncSession, db_obj: NetworkGroup, obj_in: NetworkGroupCreate):
    obj_data = obj_in.model_dump(exclude_unset=True, exclude_none=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    return db_obj

async def delete_network_group(db: AsyncSession, network_group: NetworkGroup):
    await db.delete(network_group)
    return network_group


async def count_network_groups_by_device(db: AsyncSession, device_id: int) -> int:
    """장비별 네트워크 그룹 수량을 카운트합니다."""
    result = await db.execute(
        select(func.count(NetworkGroup.id)).where(
            NetworkGroup.device_id == device_id,
            NetworkGroup.is_active == True
        )
    )
    return result.scalar() or 0


async def search_network_groups(db: AsyncSession, device_ids: list[int], names: list[str] = None,
                                 members: str = None, description: str = None,
                                 skip: int = 0, limit: int | None = None):
    """네트워크 그룹 검색"""
    from sqlalchemy import or_
    
    stmt = select(NetworkGroup).where(
        NetworkGroup.is_active == True,
        NetworkGroup.device_id.in_(device_ids),
    )
    
    # 이름 필터 (여러 값 OR)
    if names:
        name_conditions = [NetworkGroup.name.ilike(f"%{name.strip()}%") for name in names]
        stmt = stmt.where(or_(*name_conditions))
    
    # 멤버 필터
    if members:
        stmt = stmt.where(NetworkGroup.members.ilike(f"%{members.strip()}%"))
    
    # 설명 필터
    if description:
        stmt = stmt.where(NetworkGroup.description.ilike(f"%{description.strip()}%"))
    
    stmt = stmt.offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    
    result = await db.execute(stmt)
    return result.scalars().all()
