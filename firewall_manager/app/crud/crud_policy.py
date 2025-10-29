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
        stmt = stmt.where(_ilike(Policy.rule_name, req.rule_name))
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

    # Member-index filters (support multiple values OR-semantics)
    pam = models.PolicyAddressMember
    psm = models.PolicyServiceMember

    def _src_match_expr(ip_str: str):
        v, start, end = parse_ipv4_numeric(ip_str)
        if start is not None and end is not None and v == 4:
            return select(1).where(
                pam.policy_id == Policy.id,
                pam.device_id.in_(req.device_ids),
                pam.direction == 'source',
                pam.ip_version == 4,
                pam.ip_start <= end,
                pam.ip_end >= start,
            ).exists()
        return Policy.source.match(ip_str)

    def _dst_match_expr(ip_str: str):
        v, start, end = parse_ipv4_numeric(ip_str)
        if start is not None and end is not None and v == 4:
            return select(1).where(
                pam.policy_id == Policy.id,
                pam.device_id.in_(req.device_ids),
                pam.direction == 'destination',
                pam.ip_version == 4,
                pam.ip_start <= end,
                pam.ip_end >= start,
            ).exists()
        return Policy.destination.match(ip_str)

    def _svc_match_expr(token: str):
        token = (token or '').strip()
        proto = None
        ports = None
        if '/' in token:
            proto, ports = token.split('/', 1)
            proto = (proto or '').strip().lower()
        else:
            ports = token
        pstart, pend = parse_port_numeric(ports or '')
        conds = [psm.policy_id == Policy.id, psm.device_id.in_(req.device_ids)]
        if proto and proto not in {'any', '*'}:
            conds.append(func.lower(psm.protocol) == proto)
        if pstart is not None and pend is not None:
            conds.extend([psm.port_start <= pend, psm.port_end >= pstart])
            return select(1).where(*conds).exists()
        return Policy.service.match(token)

    # Apply source filters
    src_terms = [req.src_ip] if req.src_ip else []
    if req.src_ips:
        src_terms += [t for t in req.src_ips if t]
    if src_terms:
        # OR across multiple tokens
        src_expr = None
        for t in src_terms:
            e = _src_match_expr(t)
            src_expr = e if src_expr is None else (src_expr | e)
        stmt = stmt.where(src_expr)

    # Apply destination filters
    dst_terms = [req.dst_ip] if req.dst_ip else []
    if req.dst_ips:
        dst_terms += [t for t in req.dst_ips if t]
    if dst_terms:
        dst_expr = None
        for t in dst_terms:
            e = _dst_match_expr(t)
            dst_expr = e if dst_expr is None else (dst_expr | e)
        stmt = stmt.where(dst_expr)

    # Apply service filters
    svc_terms = []
    # legacy fields
    if req.protocol or req.port:
        proto = (req.protocol or '').strip().lower()
        ports = (req.port or '').strip()
        svc_terms.append(f"{proto}/{ports}" if proto or ports else '')
    if req.services:
        svc_terms += [t for t in req.services if t]
    svc_terms = [t for t in svc_terms if t]
    if svc_terms:
        svc_expr = None
        for t in svc_terms:
            e = _svc_match_expr(t)
            svc_expr = e if svc_expr is None else (svc_expr | e)
        stmt = stmt.where(svc_expr)

    # Ordering: device -> vsys -> seq -> rule_name
    stmt = stmt.order_by(Policy.device_id.asc(), Policy.vsys.asc(), Policy.seq.asc(), Policy.rule_name.asc())

    # Slice optionally
    if req.skip:
        stmt = stmt.offset(req.skip)
    if req.limit:
        stmt = stmt.limit(req.limit)

    result = await db.execute(stmt)
    return result.scalars().all()
