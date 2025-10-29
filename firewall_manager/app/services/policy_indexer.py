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
        self.ipv4_cache: Dict[str, Tuple[Optional[int], Optional[int], Optional[int]]] = {}
        self.port_cache: Dict[str, Tuple[Optional[int], Optional[int]]] = {}

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
    """
    정책 인덱스를 재구성합니다. DB 접근을 최소화하고 메모리 내에서 모든 처리를 수행하여 최적화합니다.
    """
    policy_list = list(policies)
    if not policy_list:
        return

    # 1. DB에서 모든 필요한 데이터를 한 번에 로드
    async with db.begin_nested():
        network_objs_result = await db.execute(select(models.NetworkObject).where(models.NetworkObject.device_id == device_id))
        network_grps_result = await db.execute(select(models.NetworkGroup).where(models.NetworkGroup.device_id == device_id))
        services_result = await db.execute(select(models.Service).where(models.Service.device_id == device_id))
        service_grps_result = await db.execute(select(models.ServiceGroup).where(models.ServiceGroup.device_id == device_id))

        network_objs = network_objs_result.scalars().all()
        network_grps = network_grps_result.scalars().all()
        services = services_result.scalars().all()
        service_grps = service_grps_result.scalars().all()

    # 2. DataFrame으로 변환
    rules_df = pd.DataFrame([
        {
            'Rule Name': p.rule_name,
            'Source': p.source,
            'Destination': p.destination,
            'Service': p.service,
        }
        for p in policy_list
    ])
    network_object_df = pd.DataFrame([{'Name': o.name, 'Value': o.ip_address} for o in network_objs])
    network_group_object_df = pd.DataFrame([{'Group Name': g.name, 'Entry': g.members or ''} for g in network_grps])
    service_object_df = pd.DataFrame([{'Name': s.name, 'Protocol': s.protocol or '', 'Port': s.port or ''} for s in services])
    service_group_object_df = pd.DataFrame([{'Group Name': g.name, 'Entry': g.members or ''} for g in service_grps])

    # 3. 메모리 내에서 그룹 확장 및 값 변환 (DB 접근 없음)
    resolver = Resolver()
    result_df = resolver.resolve(
        rules_df, network_object_df, network_group_object_df,
        service_object_df, service_group_object_df
    )
    if not isinstance(result_df, pd.DataFrame) or result_df.empty:
        return

    # 4. 메모리 내에서 rule_name -> policy_id 맵 생성 (DB 접근 없음)
    rule_to_pid = {p.rule_name: p.id for p in policy_list}

    # 인덱스 재작성 (배치 추가 및 파싱 캐시 적용)
    result_df = result_df.rename(columns={
        'Extracted Source': 'flattened_source',
        'Extracted Destination': 'flattened_destination',
        'Extracted Service': 'flattened_service',
    })
    flat_map = {row['Rule Name']: row for row in result_df.to_dict(orient='records') if row.get('Rule Name')}

    # 5. DB 작업을 단일 트랜잭션으로 처리
    async with db.begin_nested():
        policy_ids_to_update = [p.id for p in policy_list]
        # Delete existing index data only for the policies being updated
        if policy_ids_to_update:
            await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id.in_(policy_ids_to_update)))
            await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id.in_(policy_ids_to_update)))

        # 새 인덱스 데이터를 메모리 내에 생성
        addr_rows: List[models.PolicyAddressMember] = []
    svc_rows: List[models.PolicyServiceMember] = []

    for rule, pid in rule_to_pid.items():
        row = flat_map.get(rule)
        if not row:
            continue

        # Address members
        for direction_key, col in (("source", 'flattened_source'), ("destination", 'flattened_destination')):
            tokens = [t.strip() for t in str(row.get(col, '')).split(',') if t.strip()]
            for token in tokens:
                if token in resolver.ipv4_cache:
                    ver, start, end = resolver.ipv4_cache[token]
                else:
                    ver, start, end = parse_ipv4_numeric(token)
                    resolver.ipv4_cache[token] = (ver, start, end)
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
                if ports in resolver.port_cache:
                    pstart, pend = resolver.port_cache[ports]
                else:
                    pstart, pend = parse_port_numeric(ports)
                    resolver.port_cache[ports] = (pstart, pend)
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
