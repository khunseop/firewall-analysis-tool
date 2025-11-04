import asyncio
from typing import Iterable, Dict, Set, List, Tuple, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from app import crud, models
from app.services.normalize import parse_ipv4_numeric, parse_port_numeric
from ipaddress import ip_network, ip_address

# --- IP Range Merging Utilities (for Step 2b) ---

def _ip_str_to_numeric_range(ip_str: str) -> Optional[Tuple[int, int]]:
    """Converts a single IP, CIDR, or range string to a numeric start-end tuple."""
    try:
        if '-' in ip_str:
            start_str, end_str = ip_str.split('-', 1)
            start = int(ip_address(start_str.strip()))
            end = int(ip_address(end_str.strip()))
            return min(start, end), max(start, end)
        elif '/' in ip_str:
            net = ip_network(ip_str, strict=False)
            return int(net.network_address), int(net.broadcast_address)
        else:
            addr = int(ip_address(ip_str.strip()))
            return addr, addr
    except ValueError:
        return None

def merge_ip_ranges(ip_strings: Set[str]) -> List[Tuple[int, int]]:
    """Merges a set of IP-related strings into the smallest list of continuous numeric ranges."""
    if not ip_strings:
        return []

    # Convert all string representations to numeric ranges
    ranges = []
    for s in ip_strings:
        r = _ip_str_to_numeric_range(s)
        if r:
            ranges.append(r)

    if not ranges:
        return []

    # Sort intervals by start IP
    ranges.sort(key=lambda x: x[0])

    merged = []
    current_start, current_end = ranges[0]

    for i in range(1, len(ranges)):
        next_start, next_end = ranges[i]
        # If the next interval overlaps or is adjacent to the current one
        if next_start <= current_end + 1:
            # Merge by extending the current end
            current_end = max(current_end, next_end)
        else:
            # The current interval is finished, add it to the list
            merged.append((current_start, current_end))
            # Start a new interval
            current_start, current_end = next_start, next_end

    # Add the last processed interval
    merged.append((current_start, current_end))

    return merged


# --- Optimized Resolver ---

class Resolver:
    """A class to resolve firewall policy objects efficiently using native Python types."""

    def __init__(self) -> None:
        self._net_group_closure_cache: Dict[str, Set[str]] = {}
        self._svc_group_closure_cache: Dict[str, Set[str]] = {}

    def _expand_groups(
        self,
        name: str,
        group_map: Dict[str, List[str]],
        closure_cache: Dict[str, Set[str]],
        visited: Optional[Set[str]] = None
    ) -> Set[str]:
        """Recursively expands group members using sets for high performance."""
        if name in closure_cache:
            return closure_cache[name]

        # Protect against circular dependencies
        if visited is None:
            visited = set()
        if name in visited:
            return {name}
        visited.add(name)

        members = group_map.get(name)
        if not members:
            # It's a base object, not a group
            closure_cache[name] = {name}
            return {name}

        expanded_members: Set[str] = set()
        for member_name in members:
            expanded_members.update(self._expand_groups(member_name, group_map, closure_cache, visited.copy()))

        closure_cache[name] = expanded_members
        return expanded_members

    def pre_resolve_objects(
        self,
        network_objects: Iterable[models.NetworkObject],
        network_groups: Iterable[models.NetworkGroup],
        service_objects: Iterable[models.Service],
        service_groups: Iterable[models.ServiceGroup]
    ) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
        """Pre-resolves all objects and returns final value maps (address and service)."""
        # 1. Create base value maps and group maps directly from SQLAlchemy objects
        net_value_map = {o.name: {o.ip_address} for o in network_objects}
        net_group_map = {g.name: [m.strip() for m in (g.members or "").split(',') if m.strip()] for g in network_groups}

        svc_value_map = {}
        for s in service_objects:
            proto, port = str(s.protocol or "").lower(), str(s.port or "").replace(" ", "")
            if port and port != "none":
                svc_value_map[s.name] = {f"{proto}/{p.strip()}" for p in port.split(',')}

        svc_group_map = {g.name: [m.strip() for m in (g.members or "").split(',') if m.strip()] for g in service_groups}

        # 2. Resolve all address groups
        resolved_address_map: Dict[str, Set[str]] = {}
        all_address_names = set(net_value_map.keys()) | set(net_group_map.keys())
        for name in all_address_names:
            expanded_group_names = self._expand_groups(name, net_group_map, self._net_group_closure_cache)
            final_values: Set[str] = set()
            for n in expanded_group_names:
                final_values.update(net_value_map.get(n, {n}))
            resolved_address_map[name] = final_values

        # 3. Resolve all service groups
        resolved_service_map: Dict[str, Set[str]] = {}
        all_service_names = set(svc_value_map.keys()) | set(svc_group_map.keys())
        for name in all_service_names:
            expanded_group_names = self._expand_groups(name, svc_group_map, self._svc_group_closure_cache)
            final_values: Set[str] = set()
            for n in expanded_group_names:
                final_values.update(svc_value_map.get(n, {n}))
            resolved_service_map[name] = final_values

        return resolved_address_map, resolved_service_map


async def rebuild_policy_indices(
    db: AsyncSession,
    device_id: int,
    policies: Iterable[models.Policy],
) -> None:
    """Rebuilds policy indices with an optimized, set-based, in-memory strategy."""
    policy_list = list(policies)
    if not policy_list:
        return

    # 1. Load all necessary data from the DB at once
    network_objs = await crud.network_object.get_network_objects_by_device(db, device_id=device_id)
    network_grps = await crud.network_group.get_network_groups_by_device(db, device_id=device_id)
    services = await crud.service.get_services_by_device(db, device_id=device_id)
    service_grps = await crud.service_group.get_service_groups_by_device(db, device_id=device_id)

    # 2. Pre-resolve all objects to build final value maps
    resolver = Resolver()
    resolved_address_map, resolved_service_map = resolver.pre_resolve_objects(
        network_objs, network_grps, services, service_grps
    )

    # 3. Resolve members for each policy and prepare for DB insertion
    addr_rows, svc_rows = [], []
    ipv4_cache: Dict[str, Tuple[Optional[int], Optional[int], Optional[int]]] = {}
    port_cache: Dict[str, Tuple[Optional[int], Optional[int]]] = {}

    for policy in policy_list:
        # Resolve source members
        src_members: Set[str] = set()
        for name in [s.strip() for s in (policy.source or "").split(',') if s.strip()]:
            src_members.update(resolved_address_map.get(name, {name}))

        # Resolve destination members
        dst_members: Set[str] = set()
        for name in [s.strip() for s in (policy.destination or "").split(',') if s.strip()]:
            dst_members.update(resolved_address_map.get(name, {name}))

        # Resolve service members
        svc_members: Set[str] = set()
        for name in [s.strip() for s in (policy.service or "").split(',') if s.strip()]:
            svc_members.update(resolved_service_map.get(name, {name}))

        # --- Data Compression & Row Creation ---
        # Address members (Source and Destination)
        for direction, members in [('source', src_members), ('destination', dst_members)]:
            # IP Range Merging
            merged_ranges = merge_ip_ranges(members)
            for start_ip, end_ip in merged_ranges:
                 addr_rows.append({
                    "device_id": device_id, "policy_id": policy.id, "direction": direction,
                    "token_type": 'ipv4_range',
                    "ip_start": start_ip, "ip_end": end_ip
                })

        # Service members
        for token in filter(None, svc_members):
            token_lower = token.lower()
            if '/' in token_lower:
                proto, port_str = token_lower.split('/', 1)
            else:
                proto, port_str = ('any' if token_lower == 'any' else None), token_lower

            start, end = port_cache.get(port_str) or parse_port_numeric(port_str)
            port_cache[port_str] = (start, end)

            # Do not insert rows for tokens that couldn't be parsed into valid ports.
            if start is None or end is None:
                continue

            svc_rows.append({
                "device_id": device_id, "policy_id": policy.id, "token": token,
                "token_type": 'proto_port', "protocol": proto, "port_start": start, "port_end": end
            })

    # 4. Perform batch database operations
    async with db.begin_nested():
        policy_ids_to_update = [p.id for p in policy_list]

        # Chunk the deletion to avoid "too many SQL variables" error in SQLite
        if policy_ids_to_update:
            SQLITE_MAX_VARIABLES = 900 # Default limit is 999, being safe
            for i in range(0, len(policy_ids_to_update), SQLITE_MAX_VARIABLES):
                chunk = policy_ids_to_update[i:i + SQLITE_MAX_VARIABLES]
                await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id.in_(chunk)))
                await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id.in_(chunk)))

        if addr_rows:
            await db.run_sync(
                lambda sync_session: sync_session.bulk_insert_mappings(models.PolicyAddressMember, addr_rows)
            )
        if svc_rows:
            await db.run_sync(
                lambda sync_session: sync_session.bulk_insert_mappings(models.PolicyServiceMember, svc_rows)
            )
