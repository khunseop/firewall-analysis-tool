from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app import models, schemas


@dataclass
class AddressSet:
    has_any: bool = False
    ranges: List[Tuple[int, int]] = field(default_factory=list)  # (start, end)
    tokens: Set[str] = field(default_factory=set)  # non-numeric/fqdn tokens (original text)


@dataclass
class ServiceSet:
    has_any: bool = False
    ranges: List[Tuple[str, int, int]] = field(default_factory=list)  # (proto, start, end)
    tokens: Set[str] = field(default_factory=set)  # unknown tokens


@dataclass
class PolicyView:
    policy: models.Policy
    src: AddressSet = field(default_factory=AddressSet)
    dst: AddressSet = field(default_factory=AddressSet)
    svc: ServiceSet = field(default_factory=ServiceSet)


def _covers_ranges(outer: List[Tuple[int, int]], inner: List[Tuple[int, int]]) -> bool:
    for istart, iend in inner:
        covered = False
        for ostart, oend in outer:
            if ostart <= istart and oend >= iend:
                covered = True
                break
        if not covered:
            return False
    return True


def _covers_service_ranges(outer: List[Tuple[str, int, int]], inner: List[Tuple[str, int, int]]) -> bool:
    # group outer by protocol for quick lookup
    proto_to_outer: Dict[str, List[Tuple[int, int]]] = defaultdict(list)
    for proto, s, e in outer:
        proto_to_outer[proto].append((s, e))
    for proto, is_, ie in inner:
        covered = False
        for os, oe in proto_to_outer.get(proto, []):
            if os <= is_ and oe >= ie:
                covered = True
                break
        if not covered:
            return False
    return True


def _address_covers(a: AddressSet, b: AddressSet) -> bool:
    if a.has_any:
        return True
    # Numeric coverage
    if not _covers_ranges(a.ranges, b.ranges):
        return False
    # Non-numeric tokens must be subset
    b_extra = {t for t in b.tokens if t.lower() != "any"}
    return b_extra.issubset(a.tokens)


def _service_covers(a: ServiceSet, b: ServiceSet) -> bool:
    if a.has_any:
        return True
    if not _covers_service_ranges(a.ranges, b.ranges):
        return False
    b_extra = {t for t in b.tokens if t.lower() != "any"}
    return b_extra.issubset(a.tokens)


async def _load_policy_views(db: AsyncSession, device_ids: List[int], enabled_only: bool) -> List[PolicyView]:
    stmt = select(models.Policy).where(
        models.Policy.is_active == True,
        models.Policy.device_id.in_(device_ids),
    )
    if enabled_only:
        stmt = stmt.where(models.Policy.enable == True)
    result = await db.execute(stmt)
    policies: List[models.Policy] = result.scalars().all()
    if not policies:
        return []

    policy_ids = [p.id for p in policies]
    views: Dict[int, PolicyView] = {p.id: PolicyView(policy=p) for p in policies}

    # Address members
    pam = models.PolicyAddressMember
    r = await db.execute(select(pam).where(pam.policy_id.in_(policy_ids)))
    for m in r.scalars().all():
        view = views.get(m.policy_id)
        if view is None:
            continue
        target = view.src if (m.direction == "source") else view.dst
        tok = (m.token or "").strip()
        if tok.lower() == "any" or (m.token_type or "").lower() == "any":
            target.has_any = True
            continue
        if (m.ip_version == 4) and (m.ip_start is not None) and (m.ip_end is not None):
            target.ranges.append((int(m.ip_start), int(m.ip_end)))
        else:
            if tok:
                target.tokens.add(tok)

    # Service members
    psm = models.PolicyServiceMember
    r2 = await db.execute(select(psm).where(psm.policy_id.in_(policy_ids)))
    for m in r2.scalars().all():
        view = views.get(m.policy_id)
        if view is None:
            continue
        tok = (m.token or "").strip()
        if tok.lower() == "any":
            view.svc.has_any = True
            continue
        if (m.protocol is not None) and (m.port_start is not None) and (m.port_end is not None):
            proto = (m.protocol or "").strip().lower()
            view.svc.ranges.append((proto, int(m.port_start), int(m.port_end)))
        else:
            if tok:
                view.svc.tokens.add(tok)

    return list(views.values())


def _dup_key(v: PolicyView) -> Tuple[int, Optional[str], Optional[str], Optional[bool], frozenset, frozenset, frozenset]:
    p = v.policy
    vsys_key = (p.vsys or None)
    action = (p.action or None)
    enable = p.enable
    # Use string tokens only for stable grouping; include explicit 'any' flags as synthetic tokens
    src_tokens = set(v.src.tokens)
    dst_tokens = set(v.dst.tokens)
    svc_tokens = set(v.svc.tokens)
    if v.src.has_any:
        src_tokens.add("any")
    if v.dst.has_any:
        dst_tokens.add("any")
    if v.svc.has_any:
        svc_tokens.add("any")
    return (
        p.device_id,
        vsys_key,
        action.lower() if action else None,
        enable,
        frozenset(sorted(src_tokens)),
        frozenset(sorted(dst_tokens)),
        frozenset(sorted(svc_tokens)),
    )


def _wide_reasons(v: PolicyView, cidr_max_prefix: int) -> List[str]:
    reasons: List[str] = []
    if v.src.has_any:
        reasons.append("source_any")
    if v.dst.has_any:
        reasons.append("destination_any")
    if v.svc.has_any:
        reasons.append("service_any")

    # Wide range threshold by count of addresses
    # count >= 2^(32 - prefix)
    threshold = 1 << (32 - max(0, min(32, cidr_max_prefix)))

    for s, e in v.src.ranges:
        if (e - s + 1) >= threshold:
            reasons.append("source_wide_cidr")
            break
    for s, e in v.dst.ranges:
        if (e - s + 1) >= threshold:
            reasons.append("destination_wide_cidr")
            break
    return reasons


async def analyze_policies(db: AsyncSession, req: schemas.PolicyAnalysisRequest) -> schemas.PolicyAnalysisResponse:
    if not req.device_ids:
        return schemas.PolicyAnalysisResponse()

    views = await _load_policy_views(db, req.device_ids, req.enabled_only)
    if not views:
        return schemas.PolicyAnalysisResponse()

    # Index helpers
    by_device_vsys: Dict[Tuple[int, Optional[str]], List[PolicyView]] = defaultdict(list)
    for v in views:
        by_device_vsys[(v.policy.device_id, v.policy.vsys)].append(v)

    duplicates: List[schemas.DuplicateGroup] = []
    shadowed: List[schemas.ShadowResult] = []
    wide: List[schemas.WideResult] = []
    unused: List[schemas.UnusedResult] = []

    # Duplicates
    if req.find_duplicates:
        groups: Dict[Tuple, List[PolicyView]] = defaultdict(list)
        for v in views:
            groups[_dup_key(v)].append(v)
        for key, arr in groups.items():
            if len(arr) > 1:
                # Build summary key
                src_summary = ",".join(sorted(("any" if v.src.has_any else "") or t for t in set().union(*[a.src.tokens for a in arr])))
                dst_summary = ",".join(sorted(("any" if v.dst.has_any else "") or t for t in set().union(*[a.dst.tokens for a in arr])))
                svc_summary = ",".join(sorted(("any" if v.svc.has_any else "") or t for t in set().union(*[a.svc.tokens for a in arr])))
                policy_ids = [pv.policy.id for pv in arr]
                rule_names = [pv.policy.rule_name for pv in arr]
                device_id, vsys, action, enable, *_ = key
                duplicates.append(schemas.DuplicateGroup(
                    device_id=device_id,
                    vsys=vsys,
                    action=action,
                    enable=enable,
                    key_summary=f"src:[{src_summary}] dst:[{dst_summary}] svc:[{svc_summary}]",
                    policy_ids=policy_ids,
                    rule_names=rule_names,
                ))

    # Shadow
    if req.find_shadow:
        for (device_id, vsys), arr in by_device_vsys.items():
            # Order by seq then rule_name for deterministic behavior
            arr_sorted = sorted(arr, key=lambda v: ((v.policy.seq or 0), v.policy.rule_name or ""))
            previous: List[PolicyView] = []
            for i, b in enumerate(arr_sorted):
                for a in previous:
                    if _address_covers(a.src, b.src) and _address_covers(a.dst, b.dst) and _service_covers(a.svc, b.svc):
                        shadowed.append(schemas.ShadowResult(
                            device_id=device_id,
                            vsys=vsys,
                            action=b.policy.action,
                            shadowed_policy_id=b.policy.id,
                            shadowed_rule_name=b.policy.rule_name,
                            by_policy_id=a.policy.id,
                            by_rule_name=a.policy.rule_name,
                        ))
                        break
                previous.append(b)

    # Wide
    if req.find_wide:
        for v in views:
            reasons = _wide_reasons(v, req.wide_cidr_max_prefix)
            if reasons:
                wide.append(schemas.WideResult(
                    device_id=v.policy.device_id,
                    vsys=v.policy.vsys,
                    policy_id=v.policy.id,
                    rule_name=v.policy.rule_name,
                    reasons=reasons,
                ))

    # Unused
    if req.find_unused:
        now = datetime.now()
        cutoff = now - timedelta(days=max(0, req.unused_days))
        for v in views:
            last = v.policy.last_hit_date
            if last is None or last < cutoff:
                days_since = None
                if last is not None:
                    days_since = (now - last).days
                unused.append(schemas.UnusedResult(
                    device_id=v.policy.device_id,
                    vsys=v.policy.vsys,
                    policy_id=v.policy.id,
                    rule_name=v.policy.rule_name,
                    last_hit_date=last,
                    days_since_last_hit=days_since,
                ))

    return schemas.PolicyAnalysisResponse(
        duplicates=duplicates,
        shadowed=shadowed,
        wide=wide,
        unused=unused,
    )
