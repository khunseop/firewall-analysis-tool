from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func

from app.models.service import Service
from app.schemas.service import ServiceCreate
from datetime import datetime

"""
Service 모델에 대한 CRUD(Create, Read, Update, Delete) 연산을 정의합니다.
비동기 DB 엔진을 활용하여 서비스(포트/프로토콜) 객체 정보를 관리합니다.
"""

async def get_service_by_name_and_device(db: AsyncSession, device_id: int, name: str):
    """장비별로 고유한 서비스 이름을 기반으로 객체를 조회합니다."""
    result = await db.execute(
        select(Service).filter(Service.device_id == device_id, Service.name == name)
    )
    return result.scalars().first()

async def get_service(db: AsyncSession, service_id: int):
    """ID 기반 단일 서비스 조회를 수행합니다."""
    result = await db.execute(select(Service).filter(Service.id == service_id))
    return result.scalars().first()

async def get_services_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    """장비별 서비스 목록을 페이징 처리하여 반환합니다."""
    stmt = select(Service).filter(Service.device_id == device_id, Service.is_active == True).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def get_all_active_services_by_device(db: AsyncSession, device_id: int):
    """장비의 모든 활성 서비스 객체를 조회합니다 (동기화 및 인덱싱용)."""
    result = await db.execute(select(Service).filter(Service.device_id == device_id, Service.is_active == True))
    return result.scalars().all()

async def create_services(db: AsyncSession, services: list[ServiceCreate]):
    """
    다수의 서비스 객체를 Bulk 생성합니다.
    AsyncSession의 add_all()을 사용하여 대용량 데이터 입력 성능을 보장합니다.
    """
    db_services = [Service(**obj.model_dump()) for obj in services]
    db.add_all(db_services)
    return db_services

async def update_service(db: AsyncSession, db_obj: Service, obj_in: ServiceCreate):
    """기존 서비스 정보를 업데이트합니다 (부분 수정 지원)."""
    obj_data = obj_in.model_dump(exclude_unset=True, exclude_none=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    return db_obj

async def delete_service(db: AsyncSession, service: Service):
    """서비스 객체를 데이터베이스에서 영구 삭제합니다."""
    await db.delete(service)
    return service


async def count_services_by_device(db: AsyncSession, device_id: int) -> int:
    """장비별 서비스 객체 수량을 카운트합니다."""
    result = await db.execute(
        select(func.count(Service.id)).where(
            Service.device_id == device_id,
            Service.is_active == True
        )
    )
    return result.scalar() or 0


async def search_services(db: AsyncSession, device_ids: list[int], names: list[str] = None,
                          protocols: list[str] = None, ports: list[str] = None,
                          description: str = None, skip: int = 0, limit: int | None = None):
    """서비스 객체 검색 - 포트 범위/대역 검색 지원"""
    from sqlalchemy import or_, and_, func
    from app.services.normalize import parse_port_numeric
    
    stmt = select(Service).where(
        Service.is_active == True,
        Service.device_id.in_(device_ids),
    )
    
    # 이름 필터 (여러 값 OR)
    if names:
        name_conditions = [Service.name.ilike(f"%{name.strip()}%") for name in names]
        stmt = stmt.where(or_(*name_conditions))
    
    # 프로토콜 필터 (여러 값 OR)
    if protocols:
        protocol_conditions = [func.lower(Service.protocol) == protocol.strip().lower() for protocol in protocols]
        stmt = stmt.where(or_(*protocol_conditions))
    
    # 포트 필터 (여러 값 OR) - 범위 기반 검색 지원
    if ports:
        port_conditions = []
        for port_str in ports:
            port_str = port_str.strip()
            # 포트를 숫자 범위로 파싱 시도
            search_start, search_end = parse_port_numeric(port_str)
            
            if search_start is not None and search_end is not None:
                # 숫자 범위로 파싱 가능한 경우: 범위 기반 검색
                # 검색 범위와 객체 범위가 겹치는지 확인
                port_conditions.append(
                    and_(
                        Service.port_start.isnot(None),
                        Service.port_end.isnot(None),
                        Service.port_start <= search_end,
                        Service.port_end >= search_start
                    )
                )
            else:
                # 파싱 불가능한 경우: 문자열 매칭
                port_conditions.append(Service.port.ilike(f"%{port_str}%"))
        
        if port_conditions:
            stmt = stmt.where(or_(*port_conditions))
    
    # 설명 필터
    if description:
        stmt = stmt.where(Service.description.ilike(f"%{description.strip()}%"))
    
    stmt = stmt.offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    
    result = await db.execute(stmt)
    return result.scalars().all()
