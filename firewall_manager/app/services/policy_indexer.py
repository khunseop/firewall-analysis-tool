import asyncio
import pandas as pd
from typing import Iterable, Dict, Tuple, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from sqlalchemy.future import select

from app import crud, models
from app.services.normalize import parse_ipv4_numeric, parse_port_numeric


class Resolver:
    """Project-native resolver with caching for faster group expansion and replacement.

    - network_groups: dict[name] -> comma-joined members
    - service_groups: dict[name] -> comma-joined members
    - service_objects: map name -> list of proto/port tokens (tcp/80, udp/53-60 ...)
    - network_objects: map name -> list of address tokens (1.1.1.1, 10.0.0.0/8, ...)
    """

    def __init__(self) -> None:
        # Caches persist for the lifetime of a single Resolver instance (per rebuild run)
        self._net_group_closure_cache: Dict[str, str] = {}
        self._svc_group_closure_cache: Dict[str, str] = {}

    def _expand_groups(self, cells: str, group_map: Dict[str, str], closure_cache: Dict[str, str]) -> str:
        def dfs(name: str, depth: int = 0, max_depth: int = 20) -> str:
            cached = closure_cache.get(name)
            if cached is not None:
                return cached
            if depth > max_depth:
                closure_cache[name] = name
                return name
            entry = group_map.get(name)
            if not entry or entry == name:
                closure_cache[name] = name
                return name
            expanded: List[str] = []
            for n in str(entry).split(','):
                n = n.strip()
                if not n:
                    continue
                expanded.append(dfs(n, depth + 1, max_depth))
            flat = ','.join(set(','.join(expanded).split(','))) if expanded else name
            closure_cache[name] = flat
            return flat

        names = [t.strip() for t in str(cells).split(',') if t.strip()]
        if not names:
            return ''
        resolved = [dfs(n) for n in names]
        return ','.join(set(','.join(resolved).split(',')))

    @staticmethod
    def _replace_with_values(cells: str, value_map: Dict[str, str]) -> str:
        names = [t.strip() for t in str(cells).split(',') if t.strip()]
        if not names:
            return ''
        replaced = [str(value_map.get(n, n)) for n in names]
        return ','.join(set(replaced))

    def resolve(self, rules_df: pd.DataFrame, network_object_df: pd.DataFrame,
                network_group_df: pd.DataFrame, service_object_df: pd.DataFrame,
                service_group_df: pd.DataFrame) -> pd.DataFrame:
        # maps
        net_group_map = (network_group_df.set_index('Group Name')['Entry'].to_dict()
                         if not network_group_df.empty else {})
        net_value_map = (network_object_df.set_index('Name')['Value'].to_dict()
                         if not network_object_df.empty else {})
        svc_group_map = (service_group_df.set_index('Group Name')['Entry'].to_dict()
                         if not service_group_df.empty else {})
        # normalize service objects into proto/port tokens; split comma ports into rows
        svc_rows = []
        for _, row in service_object_df.iterrows():
            name = row.get('Name')
            proto = str(row.get('Protocol') or '').strip().lower()
            port_raw = str(row.get('Port') or '').replace(' ', '')
            if port_raw in ('', 'none'):
                continue
            parts = port_raw.split(',') if ',' in port_raw else [port_raw]
            for p in parts:
                token = f"{proto}/{p}" if proto else p
                svc_rows.append({'Name': name, 'Value': token})
        svc_value_map = pd.DataFrame(svc_rows).set_index('Name')['Value'].to_dict() if svc_rows else {}

        # expand groups with per-run caches (significantly reduces repeated DFS work)
        rules_df = rules_df.copy()
        rules_df['Resolved Source'] = rules_df['Source'].apply(
            lambda x: self._expand_groups(x, net_group_map, self._net_group_closure_cache)
        )
        rules_df['Resolved Destination'] = rules_df['Destination'].apply(
            lambda x: self._expand_groups(x, net_group_map, self._net_group_closure_cache)
        )
        rules_df['Resolved Service'] = rules_df['Service'].apply(
            lambda x: self._expand_groups(x, svc_group_map, self._svc_group_closure_cache)
        )

        # replace to values
        rules_df['Extracted Source'] = rules_df['Resolved Source'].apply(lambda x: self._replace_with_values(x, net_value_map))
        rules_df['Extracted Destination'] = rules_df['Resolved Destination'].apply(lambda x: self._replace_with_values(x, net_value_map))
        rules_df['Extracted Service'] = rules_df['Resolved Service'].apply(lambda x: self._replace_with_values(x, svc_value_map))

        rules_df.drop(columns=['Resolved Source', 'Resolved Destination', 'Resolved Service'], inplace=True)
        return rules_df


async def rebuild_policy_indices(
    db: AsyncSession,
    device_id: int,
    policies: Iterable[models.Policy],
) -> None:
    resolver = Resolver()

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

    loop = asyncio.get_running_loop()
    result_df = await loop.run_in_executor(None, lambda: resolver.resolve(
        rules_df, network_object_df, network_group_object_df,
        service_object_df, service_group_object_df
    ))
    if not isinstance(result_df, pd.DataFrame) or result_df.empty:
        return

    # rule_name -> policy id
    result = await db.execute(
        select(models.Policy).where(
            models.Policy.device_id == device_id,
            models.Policy.rule_name.in_(rule_names)
        )
    )
    policy_rows = result.scalars().all()
    rule_to_pid = {p.rule_name: p.id for p in policy_rows}

    # 인덱스 재작성 (배치 추가 및 파싱 캐시 적용)
    result_df = result_df.rename(columns={
        'Extracted Source': 'flattened_source',
        'Extracted Destination': 'flattened_destination',
        'Extracted Service': 'flattened_service',
    })
    flat_map = {row['Rule Name']: row for row in result_df.to_dict(orient='records') if row.get('Rule Name')}

    # Build delete first for target policies
    target_policy_ids = list(rule_to_pid.values())
    if target_policy_ids:
        # Delete existing members for these policies in advance
        await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id.in_(target_policy_ids)))
        await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id.in_(target_policy_ids)))

    addr_rows: List[models.PolicyAddressMember] = []
    svc_rows: List[models.PolicyServiceMember] = []

    ipv4_cache: Dict[str, Tuple[Optional[int], Optional[int], Optional[int]]] = {}
    port_cache: Dict[str, Tuple[Optional[int], Optional[int]]] = {}

    for rule, pid in rule_to_pid.items():
        row = flat_map.get(rule)
        if not row:
            continue

        # Address members
        for direction_key, col in (("source", 'flattened_source'), ("destination", 'flattened_destination')):
            tokens = [t.strip() for t in str(row.get(col, '')).split(',') if t.strip()]
            for token in tokens:
                if token in ipv4_cache:
                    ver, start, end = ipv4_cache[token]
                else:
                    ver, start, end = parse_ipv4_numeric(token)
                    ipv4_cache[token] = (ver, start, end)
                token_type = (
                    'any' if token.lower() == 'any' else
                    'ipv4_range' if (ver == 4 and start is not None and end is not None and end != start) else
                    'ipv4_single' if (ver == 4 and start is not None and end is not None and start == end) else
                    'fqdn' if any(c.isalpha() for c in token) else 'unknown'
                )
                addr_rows.append(models.PolicyAddressMember(
                    device_id=device_id,
                    policy_id=pid,
                    direction=direction_key,
                    token=token,
                    token_type=token_type,
                    ip_version=ver,
                    ip_start=start,
                    ip_end=end,
                ))

        # Service members
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
                if ports in port_cache:
                    pstart, pend = port_cache[ports]
                else:
                    pstart, pend = parse_port_numeric(ports)
                    port_cache[ports] = (pstart, pend)
                svc_rows.append(models.PolicyServiceMember(
                    device_id=device_id,
                    policy_id=pid,
                    token=token,
                    token_type='proto_port',
                    protocol=proto.strip().lower(),
                    port_start=pstart,
                    port_end=pend,
                ))
            else:
                svc_rows.append(models.PolicyServiceMember(
                    device_id=device_id,
                    policy_id=pid,
                    token=token,
                    token_type='unknown',
                    protocol=None,
                    port_start=None,
                    port_end=None,
                ))

    # Batch add to reduce ORM overhead
    if addr_rows:
        db.add_all(addr_rows)
    if svc_rows:
        db.add_all(svc_rows)
