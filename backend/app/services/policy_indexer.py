import asyncio
from typing import Iterable, Dict, Set, List, Tuple, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from app import crud, models
from app.services.policy_builder.member_resolver import compute_policy_member_rows

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
        policy_addr_rows, policy_svc_rows = compute_policy_member_rows(
            policy.source, policy.destination, policy.service,
            resolved_address_map, resolved_service_map, port_cache,
        )
        for row in policy_addr_rows:
            row["device_id"] = device_id
            row["policy_id"] = policy.id
            addr_rows.append(row)
        for row in policy_svc_rows:
            row["device_id"] = device_id
            row["policy_id"] = policy.id
            svc_rows.append(row)

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
