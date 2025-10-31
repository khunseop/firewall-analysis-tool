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

    # --- Member-index filters ---
    # We collect policy IDs from each filter type (src, dst, svc).
    # Within each filter, multiple values are treated as OR (union).
    # Between filters, the results are treated as AND (intersection).

    list_of_policy_id_sets = []

    # Source IP filter
    if req.src_ips:
        src_policy_ids = set()
        for ip_str in req.src_ips:
            _, start, end = parse_ipv4_numeric(ip_str)
            if start is not None and end is not None:
                query = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(req.device_ids),
                    models.PolicyAddressMember.direction == 'source',
                    models.PolicyAddressMember.ip_start <= end,
                    models.PolicyAddressMember.ip_end >= start
                )
                result = await db.execute(query)
                src_policy_ids.update(result.scalars().all())
        list_of_policy_id_sets.append(src_policy_ids)

    # Destination IP filter
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

    # Service filter
    if req.services:
        from sqlalchemy import and_, or_

        svc_policy_ids = set()
        or_conditions = []

        for token in req.services:
            token = token.strip()
            if not token:
                continue

            proto = None
            ports_str = token
            if '/' in token:
                parts = token.split('/', 1)
                proto = parts[0].strip().lower()
                ports_str = parts[1].strip()

            pstart, pend = parse_port_numeric(ports_str)

            if pstart is not None and pend is not None:
                # Base condition for port range
                port_condition = and_(
                    models.PolicyServiceMember.port_start <= pend,
                    models.PolicyServiceMember.port_end >= pstart
                )

                # Protocol-specific conditions
                if proto and proto != 'any':
                    # User specified a protocol (e.g., 'tcp/80')
                    final_condition = and_(port_condition, func.lower(models.PolicyServiceMember.protocol) == proto)
                else:
                    # User did not specify a protocol (e.g., '80'), or specified 'any'.
                    # Match against tcp/udp for specific ports, but also include 'any' protocol
                    # policies which match all ports.
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

    # If any index filters were applied, calculate the intersection
    if list_of_policy_id_sets:
        # 모든 필터 결과의 교집합을 계산
        final_policy_ids = set.intersection(*list_of_policy_id_sets)

        if not final_policy_ids: # 결합된 인덱스 필터와 일치하는 정책이 없음
            return []
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
