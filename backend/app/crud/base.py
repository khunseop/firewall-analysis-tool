"""장비 스코프 객체(NetworkObject/NetworkGroup/Service/ServiceGroup) 공통 CRUD.

4개 crud 모듈이 동일한 함수 묶음을 반복 정의하던 것을 제네릭으로 일원화합니다.
각 모듈은 기존 함수명을 유지하는 얇은 래퍼로 이 모듈을 호출합니다.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, or_


async def get_by_name_and_device(db: AsyncSession, model, device_id: int, name: str):
    """장비 ID와 이름으로 단일 객체를 조회합니다."""
    result = await db.execute(
        select(model).filter(model.device_id == device_id, model.name == name)
    )
    return result.scalars().first()


async def get_by_id(db: AsyncSession, model, obj_id: int):
    """고유 ID로 단일 객체를 조회합니다."""
    result = await db.execute(select(model).filter(model.id == obj_id))
    return result.scalars().first()


async def get_by_device(db: AsyncSession, model, device_id: int, skip: int = 0, limit: int | None = None):
    """특정 장비의 활성 객체 목록을 페이징하여 조회합니다."""
    stmt = select(model).filter(model.device_id == device_id, model.is_active == True).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


async def get_all_active_by_device(db: AsyncSession, model, device_id: int):
    """특정 장비의 모든 활성 객체를 조회합니다 (대량 처리용)."""
    result = await db.execute(select(model).filter(model.device_id == device_id, model.is_active == True))
    return result.scalars().all()


async def create_many(db: AsyncSession, model, objs_in: list):
    """다수의 객체를 add_all로 한 번에 생성합니다 (Bulk Insert)."""
    db_objs = [model(**obj.model_dump()) for obj in objs_in]
    db.add_all(db_objs)
    return db_objs


async def update_obj(db: AsyncSession, db_obj, obj_in):
    """기존 객체의 정보를 업데이트합니다 (None 값은 덮어쓰지 않음)."""
    obj_data = obj_in.model_dump(exclude_unset=True, exclude_none=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    return db_obj


async def delete_obj(db: AsyncSession, db_obj):
    """객체를 삭제합니다 (Hard Delete)."""
    await db.delete(db_obj)
    return db_obj


async def count_by_device(db: AsyncSession, model, device_id: int) -> int:
    """장비별 활성 객체 수량을 카운트합니다."""
    result = await db.execute(
        select(func.count(model.id)).where(
            model.device_id == device_id,
            model.is_active == True
        )
    )
    return result.scalar() or 0


async def search_groups(db: AsyncSession, model, device_ids: list[int], names: list[str] = None,
                        members: str = None, description: str = None,
                        skip: int = 0, limit: int | None = None):
    """그룹류(NetworkGroup/ServiceGroup) 공통 검색 (이름 OR / 멤버 / 설명)."""
    stmt = select(model).where(
        model.is_active == True,
        model.device_id.in_(device_ids),
    )
    if names:
        stmt = stmt.where(or_(*[model.name.ilike(f"%{name.strip()}%") for name in names]))
    if members:
        stmt = stmt.where(model.members.ilike(f"%{members.strip()}%"))
    if description:
        stmt = stmt.where(model.description.ilike(f"%{description.strip()}%"))

    stmt = stmt.offset(skip)
    if limit:
        stmt = stmt.limit(limit)

    result = await db.execute(stmt)
    return result.scalars().all()
