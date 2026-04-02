from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func
from sqlalchemy.sql import exists

from app.models.policy import Policy
from app.schemas.policy import PolicyCreate
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List

from app import models, schemas
from app.services.normalize import parse_ipv4_numeric, parse_port_numeric

async def get_policy(db: AsyncSession, policy_id: int):
    result = await db.execute(select(Policy).filter(Policy.id == policy_id))
    return result.scalars().first()

async def get_policies_by_device(db: AsyncSession, device_id: int, skip: int = 0, limit: int | None = None):
    stmt = select(Policy).filter(Policy.device_id == device_id, Policy.is_active == True).offset(skip)
    if limit:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def get_all_active_policies_by_device(db: AsyncSession, device_id: int):
    result = await db.execute(select(Policy).filter(Policy.device_id == device_id, Policy.is_active == True))
    return result.scalars().all()

async def create_policies(db: AsyncSession, policies: list[PolicyCreate]):
    db_policies = [Policy(**policy.model_dump()) for policy in policies]
    db.add_all(db_policies)
    return db_policies

async def update_policy(db: AsyncSession, db_obj: Policy, obj_in: PolicyCreate):
    # Exclude None to avoid overwriting existing values with nulls
    obj_data = obj_in.model_dump(exclude_unset=True, exclude_none=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    return db_obj

async def delete_policy(db: AsyncSession, policy: Policy):
    await db.delete(policy)
    return policy


async def count_policies_by_device(db: AsyncSession, device_id: int) -> dict:
    """장비별 정책 수량을 카운트합니다. (총 정책 수, 비활성화 정책 수)"""
    total_count = await db.execute(
        select(func.count(Policy.id)).where(
            Policy.device_id == device_id,
            Policy.is_active == True
        )
    )
    total = total_count.scalar() or 0
    
    disabled_count = await db.execute(
        select(func.count(Policy.id)).where(
            Policy.device_id == device_id,
            Policy.is_active == True,
            Policy.enable == False
        )
    )
    disabled = disabled_count.scalar() or 0
    
    return {"total": total, "disabled": disabled}


async def search_policies(db: AsyncSession, req: schemas.PolicySearchRequest) -> List[Policy]:
    if not req.device_ids:
        return []

    stmt = select(Policy).where(
        Policy.is_active == True,
        Policy.device_id.in_(req.device_ids),
    )

    # Text filters (ILIKE contains)
    def _ilike(col, val: str):
        return col.ilike(f"%{val.strip()}%")

    if req.vsys:
        stmt = stmt.where(_ilike(Policy.vsys, req.vsys))
    if req.rule_name:
        rule_names = [name.strip() for name in req.rule_name.split(',') if name.strip()]
        if rule_names:
            stmt = stmt.where(Policy.rule_name.in_(rule_names))
    if req.user:
        stmt = stmt.where(_ilike(Policy.user, req.user))
    if req.application:
        stmt = stmt.where(_ilike(Policy.application, req.application))
    if req.security_profile:
        stmt = stmt.where(_ilike(Policy.security_profile, req.security_profile))
    if req.category:
        stmt = stmt.where(_ilike(Policy.category, req.category))
    if req.description:
        stmt = stmt.where(_ilike(Policy.description, req.description))

    # Exact-ish filters
    if req.action:
        stmt = stmt.where(func.lower(Policy.action) == req.action.strip().lower())
    if req.enable is not None:
        stmt = stmt.where(Policy.enable == req.enable)

    # Date range (normalize to naive Asia/Seoul to match stored)
    def _naive_seoul(dt: datetime | None) -> datetime | None:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            try:
                dt = dt.astimezone(ZoneInfo("Asia/Seoul"))
            except Exception:
                pass
            dt = dt.replace(tzinfo=None)
        return dt
    frm = _naive_seoul(req.last_hit_date_from)
    to = _naive_seoul(req.last_hit_date_to)
    if frm is not None:
        stmt = stmt.where(Policy.last_hit_date >= frm)
    if to is not None:
        stmt = stmt.where(Policy.last_hit_date <= to)

    # --- Member-index 기반 복합 필터링 ---
    # 각 필터 유형(출발지 IP, 목적지 IP, 서비스/포트)별로 일치하는 정책 ID들을 수집합니다.
    # 동일 필터 내의 여러 값은 'OR(합집합)'으로 처리하며, 서로 다른 필터(IP vs 서비스) 간에는 'AND(교집합)'로 처리합니다.

    list_of_policy_id_sets = []

    # 출발지 IP 필터 (Source IP Index 활용)
    if req.src_ips:
        src_policy_ids = set()
        for ip_str in req.src_ips:
            # IP를 숫자 범위(start, end)로 변환하여 검색 (단일 IP 또는 대역폭 모두 지원)
            _, start, end = parse_ipv4_numeric(ip_str)
            if start is not None and end is not None:
                # 정책 대역과 검색 대역이 겹치는지(Overlapping) 확인하는 쿼리
                query = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(req.device_ids),
                    models.PolicyAddressMember.direction == 'source',
                    models.PolicyAddressMember.ip_start <= end, # 정책 시작점이 검색 종료점보다 작거나 같고
                    models.PolicyAddressMember.ip_end >= start   # 정책 종료점이 검색 시작점보다 크거나 같음
                )
                result = await db.execute(query)
                src_policy_ids.update(result.scalars().all())
        list_of_policy_id_sets.append(src_policy_ids)

    # 목적지 IP 필터 (Destination IP Index 활용)
    if req.dst_ips:
        dst_policy_ids = set()
        for ip_str in req.dst_ips:
            _, start, end = parse_ipv4_numeric(ip_str)
            if start is not None and end is not None:
                query = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(req.device_ids),
                    models.PolicyAddressMember.direction == 'destination',
                    models.PolicyAddressMember.ip_start <= end,
                    models.PolicyAddressMember.ip_end >= start
                )
                result = await db.execute(query)
                dst_policy_ids.update(result.scalars().all())
        list_of_policy_id_sets.append(dst_policy_ids)

    # 서비스 필터 (Service/Port Index 활용)
    if req.services:
        from sqlalchemy import and_, or_

        svc_policy_ids = set()
        or_conditions = []

        for token in req.services:
            token = token.strip()
            if not token:
                continue

            # 'tcp/80'과 같은 프로토콜 명시 형식 지원
            proto = None
            ports_str = token
            if '/' in token:
                parts = token.split('/', 1)
                proto = parts[0].strip().lower()
                ports_str = parts[1].strip()

            # 포트를 숫자 범위(start, end)로 변환 (단일 포트 또는 범위 검색 지원)
            pstart, pend = parse_port_numeric(ports_str)

            if pstart is not None and pend is not None:
                # 포트 범위 중첩(Overlapping) 조건
                port_condition = and_(
                    models.PolicyServiceMember.port_start <= pend,
                    models.PolicyServiceMember.port_end >= pstart
                )

                # 프로토콜 필터링 로직
                if proto and proto != 'any':
                    # 특정 프로토콜(tcp, udp 등) 명시 시 해당 프로토콜만 검색
                    final_condition = and_(port_condition, func.lower(models.PolicyServiceMember.protocol) == proto)
                else:
                    # 프로토콜 미지정 시 'any'를 포함한 기본 전송 프로토콜 검색
                    final_condition = and_(
                        port_condition,
                        func.lower(models.PolicyServiceMember.protocol).in_(['tcp', 'udp', 'any'])
                    )
                or_conditions.append(final_condition)

        if or_conditions:
            query = select(models.PolicyServiceMember.policy_id).where(
                models.PolicyServiceMember.device_id.in_(req.device_ids),
                or_(*or_conditions)
            )
            result = await db.execute(query)
            svc_policy_ids.update(result.scalars().all())

        list_of_policy_id_sets.append(svc_policy_ids)

    # 모든 개별 인덱스 필터(IP, Service) 결과의 교집합(Intersection)을 최종 정책 ID 목록으로 확정
    if list_of_policy_id_sets:
        final_policy_ids = set.intersection(*list_of_policy_id_sets)

        if not final_policy_ids:
            # 인덱스 필터를 적용했을 때 일치하는 결과가 전혀 없는 경우 즉시 빈 리스트 반환
            return []
        
        # 주 쿼리에 정책 ID 필터 추가
        stmt = stmt.where(Policy.id.in_(final_policy_ids))


    # Ordering: device -> vsys -> seq -> rule_name
    stmt = stmt.order_by(Policy.device_id.asc(), Policy.vsys.asc(), Policy.seq.asc(), Policy.rule_name.asc())

    # Slice optionally
    if req.skip:
        stmt = stmt.offset(req.skip)
    if req.limit:
        stmt = stmt.limit(req.limit)

    result = await db.execute(stmt)
    return result.scalars().all()
