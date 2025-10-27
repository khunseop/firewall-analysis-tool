import asyncio
import pandas as pd
from pathlib import Path
import importlib.util as _importlib_util
from typing import Iterable
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from sqlalchemy.future import select

from app import crud, models
from app.services.normalize import parse_ipv4_numeric, parse_port_numeric


def _load_policy_resolver_class():
    here = Path(__file__).resolve()
    candidates = [
        here.parents[5] / 'policy_resolver.py',
        here.parents[4] / 'policy_resolver.py',
    ]
    for resolver_path in candidates:
        try:
            if resolver_path.exists():
                spec = _importlib_util.spec_from_file_location('policy_resolver', str(resolver_path))
                mod = _importlib_util.module_from_spec(spec)
                assert spec and spec.loader
                spec.loader.exec_module(mod)  # type: ignore[attr-defined]
                return getattr(mod, 'PolicyResolver', None)
        except Exception:
            continue
    return None


async def rebuild_policy_indices(
    db: AsyncSession,
    device_id: int,
    policies: Iterable[models.Policy],
) -> None:
    PolicyResolverCls = _load_policy_resolver_class()
    if PolicyResolverCls is None:
        return

    rule_names = [p.rule_name for p in policies]
    if not rule_names:
        return

    # 최신 객체/그룹 수집
    network_objs = await crud.network_object.get_all_active_network_objects_by_device(db=db, device_id=device_id)
    network_grps = await crud.network_group.get_all_active_network_groups_by_device(db=db, device_id=device_id)
    services = await crud.service.get_all_active_services_by_device(db=db, device_id=device_id)
    service_grps = await crud.service_group.get_all_active_service_groups_by_device(db=db, device_id=device_id)

    rules_df = pd.DataFrame([
        {
            'Rule Name': p.rule_name,
            'Source': p.source,
            'Destination': p.destination,
            'Service': p.service,
        }
        for p in policies
    ])
    network_object_df = pd.DataFrame([
        {'Name': o.name, 'Value': o.ip_address}
        for o in network_objs
    ])
    network_group_object_df = pd.DataFrame([
        {'Group Name': g.name, 'Entry': g.members or ''}
        for g in network_grps
    ])
    service_object_df = pd.DataFrame([
        {'Name': s.name, 'Protocol': s.protocol or '', 'Port': s.port or ''}
        for s in services
    ])
    service_group_object_df = pd.DataFrame([
        {'Group Name': g.name, 'Entry': g.members or ''}
        for g in service_grps
    ])

    resolver = PolicyResolverCls()
    loop = asyncio.get_running_loop()
    result_df = await loop.run_in_executor(None, lambda: resolver.resolve(
        rules_df, network_object_df, network_group_object_df,
        service_object_df, service_group_object_df
    ))
    if not isinstance(result_df, pd.DataFrame) or result_df.empty:
        return

    # rule_name -> policy id
    result = await db.execute(select(models.Policy).where(models.Policy.device_id == device_id, models.Policy.rule_name.in_(rule_names)))
    policy_rows = result.scalars().all()
    rule_to_pid = {p.rule_name: p.id for p in policy_rows}

    # 인덱스 재작성
    result_df = result_df.rename(columns={
        'Extracted Source': 'flattened_source',
        'Extracted Destination': 'flattened_destination',
        'Extracted Service': 'flattened_service',
    })
    flat_map = {row['Rule Name']: row for row in result_df.to_dict(orient='records') if row.get('Rule Name')}

    for rule, pid in rule_to_pid.items():
        row = flat_map.get(rule)
        if not row:
            continue

        await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id == pid))
        await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id == pid))

        for direction_key, col in (("source", 'flattened_source'), ("destination", 'flattened_destination')):
            tokens = [t.strip() for t in str(row.get(col, '')).split(',') if t.strip()]
            for token in tokens:
                ver, start, end = parse_ipv4_numeric(token)
                token_type = (
                    'any' if token.lower() == 'any' else
                    'ipv4_range' if (ver == 4 and start is not None and end is not None and end != start) else
                    'ipv4_single' if (ver == 4 and start is not None and end is not None and start == end) else
                    'fqdn' if any(c.isalpha() for c in token) else 'unknown'
                )
                db.add(models.PolicyAddressMember(
                    device_id=device_id,
                    policy_id=pid,
                    direction=direction_key,
                    token=token,
                    token_type=token_type,
                    ip_version=ver,
                    ip_start=start,
                    ip_end=end,
                ))

        svc_tokens_raw = [t.strip() for t in str(row.get('flattened_service', '')).split(',') if t.strip()]
        svc_tokens: list[str] = []
        for tok in svc_tokens_raw:
            if '/' in tok and ',' in tok.split('/', 1)[1]:
                proto, ports = tok.split('/', 1)
                for p in ports.split(','):
                    svc_tokens.append(f"{proto}/{p.strip()}")
            else:
                svc_tokens.append(tok)
        for token in svc_tokens:
            if '/' in token:
                proto, ports = token.split('/', 1)
                pstart, pend = parse_port_numeric(ports)
                db.add(models.PolicyServiceMember(
                    device_id=device_id,
                    policy_id=pid,
                    token=token,
                    token_type='proto_port',
                    protocol=proto.strip().lower(),
                    port_start=pstart,
                    port_end=pend,
                ))
            else:
                db.add(models.PolicyServiceMember(
                    device_id=device_id,
                    policy_id=pid,
                    token=token,
                    token_type='unknown',
                    protocol=None,
                    port_start=None,
                    port_end=None,
                ))
