"""
아직 DB에 저장되지 않은 신규 정책을 `policy_overlap`/`insertion_analyzer`가 다룰 수 있도록
`Policy`/`PolicyAddressMember`/`PolicyServiceMember`와 동일한 인터페이스를 갖는 경량
(비영속) 객체로 변환합니다. DB에는 아무 것도 쓰지 않습니다.
"""

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.schemas.policy_builder import NewObjectSpec, NewPolicyRow
from app.services.policy_builder.member_resolver import compute_policy_member_rows
from app.services.policy_indexer import Resolver


@dataclass
class VirtualAddressMember:
    direction: str
    token: Optional[str] = None
    token_type: Optional[str] = None
    ip_start: Optional[int] = None
    ip_end: Optional[int] = None


@dataclass
class VirtualServiceMember:
    token: Optional[str] = None
    token_type: Optional[str] = None
    protocol: Optional[str] = None
    port_start: Optional[int] = None
    port_end: Optional[int] = None


@dataclass
class VirtualPolicy:
    """미저장 신규 정책. id는 실제 DB id와 겹치지 않도록 음수 sentinel을 사용합니다."""
    id: int
    row_index: int
    rule_name: str
    action: str  # 'allow' | 'deny' (policy_overlap이 allow/deny 이분법만 사용)
    application: str
    address_members: List[VirtualAddressMember] = field(default_factory=list)
    service_members: List[VirtualServiceMember] = field(default_factory=list)


def _map_rule_action(rule_action: str) -> str:
    """rule_action(allow/deny/drop/reset-* 등)을 policy_overlap이 다루는 allow/deny 이분법으로 근사합니다."""
    return "allow" if (rule_action or "").strip().lower() == "allow" else "deny"


async def resolve_virtual_policies(
    db: AsyncSession,
    device_id: int,
    new_policies: List[NewPolicyRow],
    new_objects: List[NewObjectSpec],
) -> List[VirtualPolicy]:
    """
    신규 정책 목록을 VirtualPolicy 목록으로 변환합니다.
    DB에 이미 존재하는 오브젝트 + 사용자가 입력한 신규 오브젝트 스펙을 합쳐서 해석합니다.
    """
    network_objs = list(await crud.network_object.get_network_objects_by_device(db, device_id=device_id))
    network_grps = list(await crud.network_group.get_network_groups_by_device(db, device_id=device_id))
    services = list(await crud.service.get_services_by_device(db, device_id=device_id))
    service_grps = list(await crud.service_group.get_service_groups_by_device(db, device_id=device_id))

    for obj in new_objects:
        if obj.object_kind == "address" and obj.ip_address:
            network_objs.append(SimpleNamespace(name=obj.name, ip_address=obj.ip_address))
        elif obj.object_kind == "service" and obj.protocol and obj.port:
            services.append(SimpleNamespace(name=obj.name, protocol=obj.protocol, port=obj.port))

    resolver = Resolver()
    resolved_address_map, resolved_service_map = resolver.pre_resolve_objects(
        network_objs, network_grps, services, service_grps
    )

    port_cache: Dict[str, Tuple[Optional[int], Optional[int]]] = {}
    virtual_policies: List[VirtualPolicy] = []

    for row in new_policies:
        addr_rows, svc_rows = compute_policy_member_rows(
            row.source, row.destination, row.service,
            resolved_address_map, resolved_service_map, port_cache,
        )
        address_members = [
            VirtualAddressMember(
                direction=r["direction"], token=r.get("token"), token_type=r.get("token_type"),
                ip_start=r.get("ip_start"), ip_end=r.get("ip_end"),
            )
            for r in addr_rows
        ]
        service_members = [
            VirtualServiceMember(
                token=r.get("token"), token_type=r.get("token_type"),
                protocol=r.get("protocol"), port_start=r.get("port_start"), port_end=r.get("port_end"),
            )
            for r in svc_rows
        ]
        virtual_policies.append(VirtualPolicy(
            id=-(row.row_index + 1),
            row_index=row.row_index,
            rule_name=row.rule_name,
            action=_map_rule_action(row.rule_action),
            application=row.application,
            address_members=address_members,
            service_members=service_members,
        ))

    return virtual_policies
