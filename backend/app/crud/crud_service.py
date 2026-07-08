from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import or_, and_, func

from app.crud import base
from app.models.service import Service
from app.schemas.service import ServiceCreate
from app.services.normalize import parse_port_numeric

"""
Service 모델에 대한 CRUD 연산. 공통 패턴은 crud.base로 위임합니다.
"""

async def get_service_by_name_and_device(db: AsyncSession, device_id: int, name: str):
    return await base.get_by_name_and_device(db, Service, device_id, name)

async def get_service(db: AsyncSession, service_id: int):
    return await base.get_by_id(db, Service, service_id)

async def get_services_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    return await base.get_by_device(db, Service, device_id, skip=skip, limit=limit)

async def get_all_active_services_by_device(db: AsyncSession, device_id: int):
    return await base.get_all_active_by_device(db, Service, device_id)

async def create_services(db: AsyncSession, services: list[ServiceCreate]):
    return await base.create_many(db, Service, services)

async def update_service(db: AsyncSession, db_obj: Service, obj_in: ServiceCreate):
    return await base.update_obj(db, db_obj, obj_in)

async def delete_service(db: AsyncSession, service: Service):
    return await base.delete_obj(db, service)

async def count_services_by_device(db: AsyncSession, device_id: int) -> int:
    return await base.count_by_device(db, Service, device_id)


async def search_services(db: AsyncSession, device_ids: list[int], names: list[str] = None,
                          protocols: list[str] = None, ports: list[str] = None,
                          description: str = None, skip: int = 0, limit: int | None = None):
    """서비스 객체 검색 - 포트 범위/대역 검색 지원"""
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
                # 숫자 범위로 파싱 가능한 경우: 검색 범위와 객체 범위가 겹치는지 확인
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
