from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, update, func, or_, and_
from sqlalchemy.sql import exists
from sqlalchemy.sql.elements import ClauseElement

from app.models.policy import Policy
from app.schemas.policy import PolicyCreate, FilterLeafNode, FilterGroupNode, FilterExprNode
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Union, Optional

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


async def _evaluate_leaf(
    db: AsyncSession,
    device_ids: List[int],
    node: FilterLeafNode,
) -> Optional[ClauseElement]:
    """LEAF 노드를 SQLAlchemy ColumnElement로 변환. 인덱스 테이블 조회 결과는 Policy.id.in_() 형태로 반환."""
    field, op, value = node.field, node.operator, node.value.strip()
    if not value:
        return None

    is_not = op in ('not_equals', 'not_contains')
    is_exact = op in ('equals', 'not_equals')

    # ─── 직접 컬럼 필드 ───────────────────────────────────────────────────────
    ILIKE_COLS = {
        'rule_name': Policy.rule_name,
        'vsys': Policy.vsys,
        'user': Policy.user,
        'application': Policy.application,
        'description': Policy.description,
    }
    ILIKE_NAME_COLS = {
        'src_name': Policy.source,
        'dst_name': Policy.destination,
        'service_name': Policy.service,
    }

    if field in ILIKE_COLS:
        col = ILIKE_COLS[field]
        vals = [v.strip() for v in value.split(',') if v.strip()]
        if not vals:
            return None
        if is_exact:
            clauses = [func.lower(col) == v.lower() for v in vals]
            combined = or_(*clauses) if len(clauses) > 1 else clauses[0]
            return ~combined if is_not else combined
        else:
            clauses = [col.ilike(f'%{v}%') for v in vals]
            combined = or_(*clauses) if len(clauses) > 1 else clauses[0]
            return ~combined if is_not else combined

    if field in ILIKE_NAME_COLS:
        col = ILIKE_NAME_COLS[field]
        vals = [v.strip() for v in value.split(',') if v.strip()]
        if not vals:
            return None
        if is_exact:
            clauses = [func.lower(col) == v.lower() for v in vals]
            combined = or_(*clauses) if len(clauses) > 1 else clauses[0]
            return ~combined if is_not else combined
        else:
            clauses = [col.ilike(f'%{v}%') for v in vals]
            combined = or_(*clauses) if len(clauses) > 1 else clauses[0]
            return ~combined if is_not else combined

    if field == 'action':
        clause = func.lower(Policy.action) == value.lower()
        return ~clause if is_not else clause

    if field == 'enable':
        return Policy.enable == (value.lower() == 'true')

    if field in ('last_hit_from', 'last_hit_to'):
        try:
            dt = datetime.strptime(value, '%Y-%m-%d')
        except ValueError:
            return None
        return Policy.last_hit_date >= dt if field == 'last_hit_from' else Policy.last_hit_date <= dt

    # ─── 인덱스 기반 필드 (PolicyAddressMember) ──────────────────────────────
    if field in ('src_ip', 'dst_ip'):
        direction = 'source' if field == 'src_ip' else 'destination'
        ip_tokens = [v.strip() for v in value.split(',') if v.strip()]
        ids: set = set()
        for ip_str in ip_tokens:
            _, start, end = parse_ipv4_numeric(ip_str)
            if start is None or end is None:
                continue
            if is_exact:
                q = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(device_ids),
                    models.PolicyAddressMember.direction == direction,
                    models.PolicyAddressMember.ip_start == start,
                    models.PolicyAddressMember.ip_end == end,
                )
            else:
                q = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(device_ids),
                    models.PolicyAddressMember.direction == direction,
                    models.PolicyAddressMember.ip_start <= end,
                    models.PolicyAddressMember.ip_end >= start,
                )
            result = await db.execute(q)
            ids.update(result.scalars().all())
        if not ip_tokens:
            return None
        if is_not:
            return Policy.id.notin_(ids) if ids else None
        return Policy.id.in_(ids)

    # ─── 인덱스 기반 필드 (PolicyServiceMember) ──────────────────────────────
    if field == 'service':
        svc_tokens = [v.strip() for v in value.split(',') if v.strip()]
        svc_ids: set = set()
        for token in svc_tokens:
            proto = None
            ports_str = token
            if '/' in token:
                parts = token.split('/', 1)
                proto = parts[0].strip().lower()
                ports_str = parts[1].strip()
            pstart, pend = parse_port_numeric(ports_str)
            if pstart is not None and pend is not None:
                port_cond = and_(
                    models.PolicyServiceMember.port_start <= pend,
                    models.PolicyServiceMember.port_end >= pstart,
                )
                if proto and proto != 'any':
                    final_cond = and_(port_cond, func.lower(models.PolicyServiceMember.protocol) == proto)
                else:
                    final_cond = and_(port_cond, func.lower(models.PolicyServiceMember.protocol).in_(['tcp', 'udp', 'any']))
                q = select(models.PolicyServiceMember.policy_id).where(
                    models.PolicyServiceMember.device_id.in_(device_ids),
                    final_cond,
                )
                r = await db.execute(q)
                svc_ids.update(r.scalars().all())
            else:
                q = select(models.PolicyServiceMember.policy_id).where(
                    models.PolicyServiceMember.device_id.in_(device_ids),
                    models.PolicyServiceMember.token.ilike(f'%{token}%'),
                )
                r = await db.execute(q)
                svc_ids.update(r.scalars().all())
        if not svc_tokens:
            return None
        if is_not:
            return Policy.id.notin_(svc_ids) if svc_ids else None
        return Policy.id.in_(svc_ids)

    return None


async def _evaluate_expr_tree(
    db: AsyncSession,
    device_ids: List[int],
    node: FilterExprNode,
) -> Optional[ClauseElement]:
    """필터 표현식 트리를 재귀적으로 SQLAlchemy WHERE 절로 변환."""
    if node.type == 'LEAF':
        return await _evaluate_leaf(db, device_ids, node)

    # AND / OR 노드
    child_clauses = []
    for child in node.children:
        result = await _evaluate_expr_tree(db, device_ids, child)
        if result is not None:
            child_clauses.append(result)

    if not child_clauses:
        return None
    if len(child_clauses) == 1:
        return child_clauses[0]

    return and_(*child_clauses) if node.type == 'AND' else or_(*child_clauses)


async def search_policies(db: AsyncSession, req: schemas.PolicySearchRequest) -> List[Policy]:
    if not req.device_ids:
        return []

    stmt = select(Policy).where(
        Policy.is_active == True,
        Policy.device_id.in_(req.device_ids),
    )

    # filter_expression 트리가 있으면 새 경로로 처리
    if req.filter_expression is not None:
        expr_clause = await _evaluate_expr_tree(db, req.device_ids, req.filter_expression)
        if expr_clause is not None:
            stmt = stmt.where(expr_clause)
        stmt = stmt.order_by(Policy.device_id.asc(), Policy.vsys.asc(), Policy.seq.asc(), Policy.rule_name.asc())
        if req.skip:
            stmt = stmt.offset(req.skip)
        if req.limit:
            stmt = stmt.limit(req.limit)
        result = await db.execute(stmt)
        return result.scalars().all()

    # Text filters (ILIKE contains, with optional negation)
    def _text_filter(col, val: str, negate: bool = False):
        cond = col.ilike(f"%{val.strip()}%")
        return ~cond if negate else cond

    if req.vsys:
        stmt = stmt.where(_text_filter(Policy.vsys, req.vsys, req.vsys_negate))
    if req.rule_name:
        names = [n.strip() for n in req.rule_name.split(',') if n.strip()]
        if names:
            if req.rule_name_negate:
                # NOT (A OR B) = NOT A AND NOT B
                stmt = stmt.where(and_(*[~Policy.rule_name.ilike(f'%{n}%') for n in names]))
            else:
                stmt = stmt.where(or_(*[Policy.rule_name.ilike(f'%{n}%') for n in names]))
    if req.user:
        stmt = stmt.where(_text_filter(Policy.user, req.user, req.user_negate))
    if req.application:
        stmt = stmt.where(_text_filter(Policy.application, req.application, req.application_negate))
    if req.security_profile:
        stmt = stmt.where(Policy.security_profile.ilike(f"%{req.security_profile.strip()}%"))
    if req.category:
        stmt = stmt.where(Policy.category.ilike(f"%{req.category.strip()}%"))
    if req.description:
        stmt = stmt.where(_text_filter(Policy.description, req.description, req.description_negate))

    # Exact-ish filters (with optional negation)
    if req.action:
        action_val = req.action.strip().lower()
        if req.action_negate:
            stmt = stmt.where(func.lower(Policy.action) != action_val)
        else:
            stmt = stmt.where(func.lower(Policy.action) == action_val)
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

    # 출발지 IP 필터 — overlap (포함) 검색
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

    # 출발지 IP 필터 — exact (일치) 검색
    if req.src_ips_exact:
        src_exact_ids = set()
        for ip_str in req.src_ips_exact:
            _, start, end = parse_ipv4_numeric(ip_str)
            if start is not None and end is not None:
                query = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(req.device_ids),
                    models.PolicyAddressMember.direction == 'source',
                    models.PolicyAddressMember.ip_start == start,
                    models.PolicyAddressMember.ip_end == end
                )
                result = await db.execute(query)
                src_exact_ids.update(result.scalars().all())
        list_of_policy_id_sets.append(src_exact_ids)

    # 목적지 IP 필터 — overlap (포함) 검색
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

    # 목적지 IP 필터 — exact (일치) 검색
    if req.dst_ips_exact:
        dst_exact_ids = set()
        for ip_str in req.dst_ips_exact:
            _, start, end = parse_ipv4_numeric(ip_str)
            if start is not None and end is not None:
                query = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(req.device_ids),
                    models.PolicyAddressMember.direction == 'destination',
                    models.PolicyAddressMember.ip_start == start,
                    models.PolicyAddressMember.ip_end == end
                )
                result = await db.execute(query)
                dst_exact_ids.update(result.scalars().all())
        list_of_policy_id_sets.append(dst_exact_ids)

    # 서비스 필터 (Service/Port Index 활용 + 이름 폴백)
    if req.services:
        svc_policy_ids = set()
        or_conditions = []
        name_fallback_tokens = []  # 포트 파싱 실패 → 이름 검색으로 폴백

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
                port_condition = and_(
                    models.PolicyServiceMember.port_start <= pend,
                    models.PolicyServiceMember.port_end >= pstart
                )
                if proto and proto != 'any':
                    final_condition = and_(port_condition, func.lower(models.PolicyServiceMember.protocol) == proto)
                else:
                    final_condition = and_(
                        port_condition,
                        func.lower(models.PolicyServiceMember.protocol).in_(['tcp', 'udp', 'any'])
                    )
                or_conditions.append(final_condition)
            else:
                # 포트로 파싱 불가 → 서비스 객체명 ILIKE로 폴백
                name_fallback_tokens.append(token)

        if or_conditions:
            query = select(models.PolicyServiceMember.policy_id).where(
                models.PolicyServiceMember.device_id.in_(req.device_ids),
                or_(*or_conditions)
            )
            result = await db.execute(query)
            svc_policy_ids.update(result.scalars().all())

        if name_fallback_tokens:
            name_query = select(models.PolicyServiceMember.policy_id).where(
                models.PolicyServiceMember.device_id.in_(req.device_ids),
                or_(*[models.PolicyServiceMember.token.ilike(f'%{n}%') for n in name_fallback_tokens])
            )
            result = await db.execute(name_query)
            svc_policy_ids.update(result.scalars().all())

        # 실제 검색이 수행된 경우에만 교집합에 추가 (빈 set이 모든 결과를 지우는 버그 방지)
        if or_conditions or name_fallback_tokens:
            list_of_policy_id_sets.append(svc_policy_ids)

    # 출발지 객체명 필터 — Policy.source ILIKE (인덱서가 원본 객체명을 token으로 저장하지 않으므로)
    if req.src_names:
        valid_src_names = [n.strip() for n in req.src_names if n.strip()]
        if valid_src_names:
            stmt = stmt.where(or_(*[Policy.source.ilike(f'%{n}%') for n in valid_src_names]))

    # 목적지 객체명 필터 — Policy.destination ILIKE
    if req.dst_names:
        valid_dst_names = [n.strip() for n in req.dst_names if n.strip()]
        if valid_dst_names:
            stmt = stmt.where(or_(*[Policy.destination.ilike(f'%{n}%') for n in valid_dst_names]))

    # 서비스 객체명 필터 — Policy.service ILIKE (인덱서가 원본 서비스 객체명을 보존하지 않으므로)
    if req.service_names:
        valid_svc_names = [n.strip() for n in req.service_names if n.strip()]
        if valid_svc_names:
            stmt = stmt.where(or_(*[Policy.service.ilike(f'%{n}%') for n in valid_svc_names]))

    # 모든 개별 인덱스 필터(IP, Service) 결과의 교집합(Intersection)을 최종 정책 ID 목록으로 확정
    if list_of_policy_id_sets:
        final_policy_ids = set.intersection(*list_of_policy_id_sets)

        if not final_policy_ids:
            return []

        stmt = stmt.where(Policy.id.in_(final_policy_ids))

    # ─── 제외 필터 (NOT IN) ───────────────────────────────────────────────────

    async def _collect_addr_ids(direction: str, ip_list: list) -> set:
        ids: set = set()
        for ip_str in ip_list:
            _, start, end = parse_ipv4_numeric(ip_str)
            if start is not None and end is not None:
                q = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(req.device_ids),
                    models.PolicyAddressMember.direction == direction,
                    models.PolicyAddressMember.ip_start <= end,
                    models.PolicyAddressMember.ip_end >= start
                )
                r = await db.execute(q)
                ids.update(r.scalars().all())
        return ids

    async def _collect_svc_ids(token_list: list) -> set:
        ids: set = set()
        svc_or: list = []
        name_tokens: list = []
        for token in token_list:
            token = token.strip()
            if not token:
                continue
            proto = None
            ports_str = token
            if '/' in token:
                p, ports_str = token.split('/', 1)
                proto = p.strip().lower()
                ports_str = ports_str.strip()
            pstart, pend = parse_port_numeric(ports_str)
            if pstart is not None and pend is not None:
                pc = and_(
                    models.PolicyServiceMember.port_start <= pend,
                    models.PolicyServiceMember.port_end >= pstart
                )
                if proto and proto != 'any':
                    svc_or.append(and_(pc, func.lower(models.PolicyServiceMember.protocol) == proto))
                else:
                    svc_or.append(and_(pc, func.lower(models.PolicyServiceMember.protocol).in_(['tcp', 'udp', 'any'])))
            else:
                name_tokens.append(token)
        if svc_or:
            q = select(models.PolicyServiceMember.policy_id).where(
                models.PolicyServiceMember.device_id.in_(req.device_ids),
                or_(*svc_or)
            )
            r = await db.execute(q)
            ids.update(r.scalars().all())
        if name_tokens:
            q = select(models.PolicyServiceMember.policy_id).where(
                models.PolicyServiceMember.device_id.in_(req.device_ids),
                or_(*[models.PolicyServiceMember.token.ilike(f'%{n}%') for n in name_tokens])
            )
            r = await db.execute(q)
            ids.update(r.scalars().all())
        return ids

    if req.src_ips_exclude:
        excluded = await _collect_addr_ids('source', req.src_ips_exclude)
        if excluded:
            stmt = stmt.where(Policy.id.notin_(excluded))

    if req.src_ips_exact_exclude:
        ids: set = set()
        for ip_str in req.src_ips_exact_exclude:
            _, start, end = parse_ipv4_numeric(ip_str)
            if start is not None and end is not None:
                q = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(req.device_ids),
                    models.PolicyAddressMember.direction == 'source',
                    models.PolicyAddressMember.ip_start == start,
                    models.PolicyAddressMember.ip_end == end
                )
                r = await db.execute(q)
                ids.update(r.scalars().all())
        if ids:
            stmt = stmt.where(Policy.id.notin_(ids))

    if req.dst_ips_exclude:
        excluded = await _collect_addr_ids('destination', req.dst_ips_exclude)
        if excluded:
            stmt = stmt.where(Policy.id.notin_(excluded))

    if req.dst_ips_exact_exclude:
        ids: set = set()
        for ip_str in req.dst_ips_exact_exclude:
            _, start, end = parse_ipv4_numeric(ip_str)
            if start is not None and end is not None:
                q = select(models.PolicyAddressMember.policy_id).where(
                    models.PolicyAddressMember.device_id.in_(req.device_ids),
                    models.PolicyAddressMember.direction == 'destination',
                    models.PolicyAddressMember.ip_start == start,
                    models.PolicyAddressMember.ip_end == end
                )
                r = await db.execute(q)
                ids.update(r.scalars().all())
        if ids:
            stmt = stmt.where(Policy.id.notin_(ids))

    if req.services_exclude:
        excluded = await _collect_svc_ids(req.services_exclude)
        if excluded:
            stmt = stmt.where(Policy.id.notin_(excluded))

    if req.src_names_exclude:
        valid = [n.strip() for n in req.src_names_exclude if n.strip()]
        if valid:
            stmt = stmt.where(~or_(*[Policy.source.ilike(f'%{n}%') for n in valid]))

    if req.dst_names_exclude:
        valid = [n.strip() for n in req.dst_names_exclude if n.strip()]
        if valid:
            stmt = stmt.where(~or_(*[Policy.destination.ilike(f'%{n}%') for n in valid]))

    if req.service_names_exclude:
        valid = [n.strip() for n in req.service_names_exclude if n.strip()]
        if valid:
            stmt = stmt.where(~or_(*[Policy.service.ilike(f'%{n}%') for n in valid]))

    # Ordering: device -> vsys -> seq -> rule_name
    stmt = stmt.order_by(Policy.device_id.asc(), Policy.vsys.asc(), Policy.seq.asc(), Policy.rule_name.asc())

    # Slice optionally
    if req.skip:
        stmt = stmt.offset(req.skip)
    if req.limit:
        stmt = stmt.limit(req.limit)

    result = await db.execute(stmt)
    return result.scalars().all()
