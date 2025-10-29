import asyncio
import pandas as pd
from typing import Iterable, Dict, Tuple, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from sqlalchemy.future import select

from app import crud, models
from app.services.normalize import parse_ipv4_numeric, parse_port_numeric


class Resolver:
    """A class to resolve and cache firewall policy objects for efficient indexing."""

    def __init__(self) -> None:
        self._net_group_closure_cache: Dict[str, str] = {}
        self._svc_group_closure_cache: Dict[str, str] = {}
        self.ipv4_cache: Dict[str, Tuple[Optional[int], Optional[int], Optional[int]]] = {}
        self.port_cache: Dict[str, Tuple[Optional[int], Optional[int]]] = {}
        self.resolved_address_map: Dict[str, str] = {}
        self.resolved_service_map: Dict[str, str] = {}

    def _expand_groups(self, name: str, group_map: Dict[str, str], closure_cache: Dict[str, str]) -> str:
        """Recursively expand group members with memoization."""
        if name in closure_cache:
            return closure_cache[name]

        # Protect against excessive recursion depth
        MAX_DEPTH = 20

        def dfs(current_name: str, visited: set) -> str:
            if current_name in visited:
                return current_name # Circular dependency detected

            visited.add(current_name)

            if len(visited) > MAX_DEPTH:
                return current_name

            members = group_map.get(current_name)
            if not members:
                return current_name

            expanded_members = []
            for member_name in members.split(','):
                member_name = member_name.strip()
                if member_name:
                    expanded_members.append(dfs(member_name, visited.copy()))

            return ','.join(sorted(list(set(','.join(expanded_members).split(',')))))

        result = dfs(name, set())
        closure_cache[name] = result
        return result

    def pre_resolve_objects(
        self,
        network_objects: pd.DataFrame,
        network_groups: pd.DataFrame,
        service_objects: pd.DataFrame,
        service_groups: pd.DataFrame
    ) -> None:
        """Pre-resolves all network and service objects to create a final value map."""
        net_value_map = network_objects.set_index('Name')['Value'].to_dict() if not network_objects.empty else {}
        net_group_map = network_groups.set_index('Group Name')['Entry'].to_dict() if not network_groups.empty else {}

        # Combine base objects and groups for address resolution
        all_address_names = list(net_value_map.keys()) + list(net_group_map.keys())
        for name in all_address_names:
            expanded_groups = self._expand_groups(name, net_group_map, self._net_group_closure_cache)
            final_values = {net_value_map.get(n.strip(), n.strip()) for n in expanded_groups.split(',')}
            self.resolved_address_map[name] = ','.join(sorted(list(final_values)))

        # Handle service objects
        svc_value_map = {}
        if not service_objects.empty:
            for _, row in service_objects.iterrows():
                name, proto, port = row.get('Name'), str(row.get('Protocol', '')).lower(), str(row.get('Port', '')).replace(' ', '')
                if port and port != 'none':
                    svc_value_map[name] = ','.join([f"{proto}/{p.strip()}" for p in port.split(',')])

        svc_group_map = service_groups.set_index('Group Name')['Entry'].to_dict() if not service_groups.empty else {}
        all_service_names = list(svc_value_map.keys()) + list(svc_group_map.keys())
        for name in all_service_names:
            expanded_groups = self._expand_groups(name, svc_group_map, self._svc_group_closure_cache)
            final_values = {svc_value_map.get(n.strip(), n.strip()) for n in expanded_groups.split(',')}
            self.resolved_service_map[name] = ','.join(sorted(list(final_values)))

    def resolve_policy_members(self, policy_df: pd.DataFrame) -> pd.DataFrame:
        """Resolves policy members using the pre-built maps."""

        def map_values(member_str: str, resolved_map: Dict[str, str]) -> str:
            if not isinstance(member_str, str): return ''
            final_values = {resolved_map.get(n.strip(), n.strip()) for n in member_str.split(',')}
            return ','.join(sorted(list(final_values)))

        policy_df['flattened_source'] = policy_df['source'].apply(map_values, resolved_map=self.resolved_address_map)
        policy_df['flattened_destination'] = policy_df['destination'].apply(map_values, resolved_map=self.resolved_address_map)
        policy_df['flattened_service'] = policy_df['service'].apply(map_values, resolved_map=self.resolved_service_map)
        return policy_df


async def rebuild_policy_indices(
    db: AsyncSession,
    device_id: int,
    policies: Iterable[models.Policy],
) -> None:
    """Rebuilds policy indices with an optimized, pre-resolving strategy."""
    policy_list = list(policies)
    if not policy_list:
        return

    # 1. Load all necessary data from the DB at once
    network_objs = await crud.network_object.get_network_objects_by_device(db, device_id=device_id)
    network_grps = await crud.network_group.get_network_groups_by_device(db, device_id=device_id)
    services = await crud.service.get_services_by_device(db, device_id=device_id)
    service_grps = await crud.service_group.get_service_groups_by_device(db, device_id=device_id)

    # 2. Convert to DataFrames
    network_object_df = pd.DataFrame([{'Name': o.name, 'Value': o.ip_address} for o in network_objs])
    network_group_df = pd.DataFrame([{'Group Name': g.name, 'Entry': g.members or ''} for g in network_grps])
    service_object_df = pd.DataFrame([{'Name': s.name, 'Protocol': s.protocol, 'Port': s.port} for s in services])
    service_group_df = pd.DataFrame([{'Group Name': g.name, 'Entry': g.members or ''} for g in service_grps])

    # 3. Pre-resolve all objects to build value maps
    resolver = Resolver()
    resolver.pre_resolve_objects(network_object_df, network_group_df, service_object_df, service_group_df)

    # 4. Create a DataFrame for policies and resolve their members
    policy_df = pd.DataFrame([p.__dict__ for p in policy_list])
    resolved_df = resolver.resolve_policy_members(policy_df)

    # 5. Process and insert index data into the database
    addr_rows, svc_rows = [], []
    for _, row in resolved_df.iterrows():
        policy_id = row['id']

        # Address members
        for direction in ['source', 'destination']:
            tokens = row[f'flattened_{direction}'].split(',')
            for token in filter(None, tokens):
                ver, start, end = resolver.ipv4_cache.get(token) or parse_ipv4_numeric(token)
                resolver.ipv4_cache[token] = (ver, start, end)
                addr_rows.append(models.PolicyAddressMember(
                    device_id=device_id, policy_id=policy_id, direction=direction, token=token,
                    token_type='ipv4_single' if ver == 4 and start == end else 'ipv4_range',
                    ip_version=ver, ip_start=start, ip_end=end
                ))

        # Service members
        tokens = row['flattened_service'].split(',')
        for token in filter(None, tokens):
            proto, port_str = token.split('/', 1) if '/' in token else (None, token)
            start, end = resolver.port_cache.get(port_str) or parse_port_numeric(port_str)
            resolver.port_cache[port_str] = (start, end)
            svc_rows.append(models.PolicyServiceMember(
                device_id=device_id, policy_id=policy_id, token=token,
                token_type='proto_port', protocol=proto, port_start=start, port_end=end
            ))

    # 6. Perform batch database operations
    async with db.begin_nested():
        policy_ids_to_update = [p.id for p in policy_list]
        if policy_ids_to_update:
            await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id.in_(policy_ids_to_update)))
            await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id.in_(policy_ids_to_update)))

        if addr_rows: db.add_all(addr_rows)
        if svc_rows: db.add_all(svc_rows)
