import asyncio
from typing import Iterable, Dict, Set, List, Tuple, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from app import crud, models
from app.services.normalize import parse_ipv4_numeric, parse_port_numeric
from ipaddress import ip_network, ip_address

# --- IP 범위 병합 유틸리티 (Step 2b용) ---

def _ip_str_to_numeric_range(ip_str: str) -> Optional[Tuple[int, int]]:
    """
    단일 IP, CIDR 또는 범위 문자열을 숫자형 시작-끝 튜플로 변환합니다.
    
    Args:
        ip_str: 변환할 IP 문자열 (예: '1.1.1.1', '1.1.1.0/24', '1.1.1.1-1.1.1.5')
        
    Returns:
        (시작_IP_숫자, 끝_IP_숫자) 형태의 튜플, 변환 실패 시 None
    """
    try:
        # '시작-끝' 형식의 범위 처리
        if '-' in ip_str:
            start_str, end_str = ip_str.split('-', 1)
            start = int(ip_address(start_str.strip()))
            end = int(ip_address(end_str.strip()))
            return min(start, end), max(start, end)
        # CIDR 형식 처리 (예: 1.1.1.0/24)
        elif '/' in ip_str:
            net = ip_network(ip_str, strict=False)
            return int(net.network_address), int(net.broadcast_address)
        # 단일 IP 주소 처리
        else:
            addr = int(ip_address(ip_str.strip()))
            return addr, addr
    except ValueError:
        return None

def merge_ip_ranges(ip_strings: Set[str]) -> List[Tuple[int, int]]:
    """
    IP 관련 문자열 집합을 최소한의 연속된 숫자 범위 리스트로 병합합니다.
    이 알고리즘은 중복되거나 인접한 IP 범위를 하나로 합쳐 인덱스 크기를 줄입니다.
    
    Args:
        ip_strings: IP 주소, CIDR, 범위 문자열 집합
        
    Returns:
        병합된 (시작_IP_숫자, 끝_IP_숫자) 튜플의 리스트
    """
    if not ip_strings:
        return []

    # 1. 모든 문자열 표현을 숫자형 범위(start, end)로 변환
    ranges = []
    for s in ip_strings:
        r = _ip_str_to_numeric_range(s)
        if r:
            ranges.append(r)

    if not ranges:
        return []

    # 2. 시작 IP 주소를 기준으로 정렬 (Greedy 병합을 위함)
    ranges.sort(key=lambda x: x[0])

    merged = []
    current_start, current_end = ranges[0]

    for i in range(1, len(ranges)):
        next_start, next_end = ranges[i]
        # 현재 범위의 끝과 다음 범위의 시작이 겹치거나 인접한 경우 (next_start <= current_end + 1)
        if next_start <= current_end + 1:
            # 현재 범위의 끝을 확장하여 병합
            current_end = max(current_end, next_end)
        else:
            # 겹치지 않으면 현재까지의 범위를 결과에 추가하고 새로운 범위 시작
            merged.append((current_start, current_end))
            current_start, current_end = next_start, next_end

    # 마지막 처리 중인 범위를 추가
    merged.append((current_start, current_end))

    return merged


# --- 최적화된 리졸버 (Resolver) ---

class Resolver:
    """
    방화벽 정책 객체를 효율적으로 분석하고 그룹을 확장하는 클래스입니다.
    Python 기본 자료형(Set, Dict)을 사용하여 메모리 내에서 고속으로 연산합니다.
    """

    def __init__(self) -> None:
        # 그룹 확장 결과를 재사용하기 위한 캐시 (메모이제이션)
        self._net_group_closure_cache: Dict[str, Set[str]] = {}
        self._svc_group_closure_cache: Dict[str, Set[str]] = {}

    def _expand_groups(
        self,
        name: str,
        group_map: Dict[str, List[str]],
        closure_cache: Dict[str, Set[str]],
        visited: Optional[Set[str]] = None
    ) -> Set[str]:
        """
        그룹 멤버를 재귀적으로 확장합니다.
        
        복잡한 중첩 그룹을 단일 객체 리스트로 풀어서 반환하며, 
        순환 참조(Circular Dependency)를 방지하는 로직이 포함되어 있습니다.
        """
        # 이미 계산된 결과가 캐시에 있으면 즉시 반환
        if name in closure_cache:
            return closure_cache[name]

        # 순환 참조 보호 로직: 현재 탐색 경로에 이미 존재하는 이름이면 중단
        if visited is None:
            visited = set()
        if name in visited:
            return {name}
        visited.add(name)

        # 해당 이름이 그룹 맵에 존재하는지 확인
        if name in group_map:
            members = group_map[name]
            # 빈 그룹인 경우 특수 마커를 반환하여 존재 여부 기록
            if not members:
                closure_cache[name] = {f"__GROUP__:{name}"}
                return {f"__GROUP__:{name}"}
            
            # 모든 멤버를 재귀적으로 확장하여 합집합(Set) 생성
            expanded_members: Set[str] = set()
            for member_name in members:
                expanded_members.update(self._expand_groups(member_name, group_map, closure_cache, visited.copy()))
            
            # 결과 캐싱 후 반환
            closure_cache[name] = expanded_members
            return expanded_members
        else:
            # 그룹이 아닌 기본 객체인 경우 자기 자신을 반환
            closure_cache[name] = {name}
            return {name}

    def pre_resolve_objects(
        self,
        network_objects: Iterable[models.NetworkObject],
        network_groups: Iterable[models.NetworkGroup],
        service_objects: Iterable[models.Service],
        service_groups: Iterable[models.ServiceGroup]
    ) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
        """
        모든 네트워크 및 서비스 객체를 사전 분석하여 최종 값(IP/Port) 맵을 생성합니다.
        
        Returns:
            (최종_주소_맵, 최종_서비스_맵) 튜플
        """
        # 1. SQLAlchemy 객체로부터 기본 값 맵과 그룹 맵 생성
        net_value_map = {o.name: {o.ip_address} for o in network_objects}
        net_group_map = {g.name: [m.strip() for m in (g.members or "").split(',') if m.strip()] for g in network_groups}

        svc_value_map = {}
        for s in service_objects:
            proto, port = str(s.protocol or "").lower(), str(s.port or "").replace(" ", "")
            if port and port != "none":
                svc_value_map[s.name] = {f"{proto}/{p.strip()}" for p in port.split(',')}

        svc_group_map = {g.name: [m.strip() for m in (g.members or "").split(',') if m.strip()] for g in service_groups}

        # 2. 모든 주소 그룹 분석 (재귀적 확장 적용)
        resolved_address_map: Dict[str, Set[str]] = {}
        all_address_names = set(net_value_map.keys()) | set(net_group_map.keys())
        for name in all_address_names:
            expanded_group_names = self._expand_groups(name, net_group_map, self._net_group_closure_cache)
            final_values: Set[str] = set()
            for n in expanded_group_names:
                final_values.update(net_value_map.get(n, {n}))
            resolved_address_map[name] = final_values

        # 3. 모든 서비스 그룹 분석 (재귀적 확장 적용)
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
    """
    메모리 내에서 최적화된 방식으로 정책 인덱스를 재구축합니다.
    
    이 함수는 정책의 소스, 목적지, 서비스를 분석하여 검색 가능한 인덱스 테이블로 변환합니다.
    객체 그룹 확장, IP 범위 병합, 대량 삽입(Bulk Insert) 과정을 거칩니다.
    """
    policy_list = list(policies)
    if not policy_list:
        return

    # 1. DB에서 필요한 모든 데이터를 한 번에 로드 (N+1 문제 방지)
    network_objs = await crud.network_object.get_network_objects_by_device(db, device_id=device_id)
    network_grps = await crud.network_group.get_network_groups_by_device(db, device_id=device_id)
    services = await crud.service.get_services_by_device(db, device_id=device_id)
    service_grps = await crud.service_group.get_service_groups_by_device(db, device_id=device_id)

    # 2. 객체 리졸버를 사용하여 모든 그룹과 멤버 사전 분석
    resolver = Resolver()
    resolved_address_map, resolved_service_map = resolver.pre_resolve_objects(
        network_objs, network_grps, services, service_grps
    )

    # 3. 각 정책별 멤버 분석 및 DB 삽입용 데이터 준비
    addr_rows, svc_rows = [], []
    port_cache: Dict[str, Tuple[Optional[int], Optional[int]]] = {}

    for policy in policy_list:
        # 소스 멤버 분석
        src_members: Set[str] = set()
        for name in [s.strip() for s in (policy.source or "").split(',') if s.strip()]:
            src_members.update(resolved_address_map.get(name, {name}))

        # 목적지 멤버 분석
        dst_members: Set[str] = set()
        for name in [s.strip() for s in (policy.destination or "").split(',') if s.strip()]:
            dst_members.update(resolved_address_map.get(name, {name}))

        # 서비스 멤버 분석
        svc_members: Set[str] = set()
        for name in [s.strip() for s in (policy.service or "").split(',') if s.strip()]:
            svc_members.update(resolved_service_map.get(name, {name}))

        # --- 데이터 압축 및 로우(Row) 생성 ---
        
        # 주소 멤버 (Source & Destination) 처리
        for direction, members in [('source', src_members), ('destination', dst_members)]:
            # 분석 가능한 IP 멤버와 빈 그룹 마커 분리
            ip_members = {m for m in members if not m.startswith("__GROUP__:")}
            group_markers = {m for m in members if m.startswith("__GROUP__:")}
            
            # IP 범위 병합 알고리즘 적용 (Greedy Merging)
            merged_ranges = merge_ip_ranges(ip_members)
            for start_ip, end_ip in merged_ranges:
                 addr_rows.append({
                    "device_id": device_id, "policy_id": policy.id, "direction": direction,
                    "token_type": 'ipv4_range',
                    "ip_start": start_ip, "ip_end": end_ip
                })
            
            # 빈 그룹 마커 저장 (검색 가능하도록 토큰으로 기록)
            for marker in group_markers:
                group_name = marker.replace("__GROUP__:", "", 1)
                addr_rows.append({
                    "device_id": device_id, "policy_id": policy.id, "direction": direction,
                    "token": group_name,
                    "token_type": 'unknown',
                    "ip_start": None, "ip_end": None
                })

        # 서비스 멤버 처리
        for token in filter(None, svc_members):
            # 빈 서비스 그룹 마커 처리
            if token.startswith("__GROUP__:"):
                group_name = token.replace("__GROUP__:", "", 1)
                svc_rows.append({
                    "device_id": device_id, "policy_id": policy.id, "token": group_name,
                    "token_type": 'unknown',
                    "protocol": None, "port_start": None, "port_end": None
                })
                continue
            
            # 프로토콜 및 포트 분석
            token_lower = token.lower()
            if '/' in token_lower:
                proto, port_str = token_lower.split('/', 1)
            else:
                proto, port_str = ('any' if token_lower == 'any' else None), token_lower

            # 포트 파싱 결과 캐싱으로 성능 향상
            if port_str in port_cache:
                start, end = port_cache[port_str]
            else:
                start, end = parse_port_numeric(port_str)
                port_cache[port_str] = (start, end)

            # 유효하지 않은 포트 정보는 인덱스에서 제외
            if start is None or end is None:
                continue

            svc_rows.append({
                "device_id": device_id, "policy_id": policy.id, "token": token,
                "token_type": 'proto_port', "protocol": proto, "port_start": start, "port_end": end
            })

    # 4. 일괄 데이터베이스 작업 (Batch Operation)
    async with db.begin_nested():
        policy_ids_to_update = [p.id for p in policy_list]

        # SQLite 변수 제한(SQLITE_MAX_VARIABLES)을 고려하여 청크 단위로 기존 인덱스 삭제
        if policy_ids_to_update:
            SQLITE_MAX_VARIABLES = 900
            for i in range(0, len(policy_ids_to_update), SQLITE_MAX_VARIABLES):
                chunk = policy_ids_to_update[i:i + SQLITE_MAX_VARIABLES]
                await db.execute(delete(models.PolicyAddressMember).where(models.PolicyAddressMember.policy_id.in_(chunk)))
                await db.execute(delete(models.PolicyServiceMember).where(models.PolicyServiceMember.policy_id.in_(chunk)))

        # 대량 삽입(Bulk Insert)으로 성능 최적화
        if addr_rows:
            await db.run_sync(
                lambda sync_session: sync_session.bulk_insert_mappings(models.PolicyAddressMember, addr_rows)
            )
        if svc_rows:
            await db.run_sync(
                lambda sync_session: sync_session.bulk_insert_mappings(models.PolicyServiceMember, svc_rows)
            )
