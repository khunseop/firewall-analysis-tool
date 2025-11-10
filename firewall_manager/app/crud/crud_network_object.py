from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func

from app.models.network_object import NetworkObject
from app.schemas.network_object import NetworkObjectCreate
from datetime import datetime

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


async def search_network_objects(db: AsyncSession, device_ids: list[int], names: list[str] = None, 
                                  ip_addresses: list[str] = None, type: str = None, 
                                  description: str = None, skip: int = 0, limit: int | None = None):
    """네트워크 객체 검색 - IP 범위/대역 검색 지원"""
    from sqlalchemy import or_, and_
    from app.services.normalize import parse_ipv4_numeric
    
    stmt = select(NetworkObject).where(
        NetworkObject.is_active == True,
        NetworkObject.device_id.in_(device_ids),
    )
    
    # 이름 필터 (여러 값 OR)
    if names:
        name_conditions = [NetworkObject.name.ilike(f"%{name.strip()}%") for name in names]
        stmt = stmt.where(or_(*name_conditions))
    
    # IP 주소 필터 (여러 값 OR) - 범위 기반 검색 지원
    if ip_addresses:
        ip_conditions = []
        for ip_str in ip_addresses:
            ip_str = ip_str.strip()
            # IP 주소를 숫자 범위로 파싱 시도
            _, search_start, search_end = parse_ipv4_numeric(ip_str)
            
            if search_start is not None and search_end is not None:
                # 숫자 범위로 파싱 가능한 경우: 범위 기반 검색
                # 검색 범위와 객체 범위가 겹치는지 확인
                ip_conditions.append(
                    and_(
                        NetworkObject.ip_start.isnot(None),
                        NetworkObject.ip_end.isnot(None),
                        NetworkObject.ip_start <= search_end,
                        NetworkObject.ip_end >= search_start
                    )
                )
            else:
                # 파싱 불가능한 경우 (FQDN 등): 문자열 매칭
                ip_conditions.append(NetworkObject.ip_address.ilike(f"%{ip_str}%"))
        
        if ip_conditions:
            stmt = stmt.where(or_(*ip_conditions))
    
    # 타입 필터
    if type:
        stmt = stmt.where(NetworkObject.type.ilike(f"%{type.strip()}%"))
    
    # 설명 필터
    if description:
        stmt = stmt.where(NetworkObject.description.ilike(f"%{description.strip()}%"))
    
    stmt = stmt.offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    
    result = await db.execute(stmt)
    return result.scalars().all()
