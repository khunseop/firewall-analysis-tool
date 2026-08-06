"""
신규 정책이 참조하는 주소/서비스 오브젝트 중, 장비 DB에 아직 없는 것을 감지합니다.
"""

import re
from typing import Dict, List, Set

from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.schemas.policy_builder import NewPolicyRow, ObjectGapItem

# CIDR/단일 IP/IP 범위처럼 보이는 토큰은 오브젝트 이름이 아니라 리터럴 값이므로 갭 대상에서 제외
_IP_LITERAL_RE = re.compile(
    r"^\d{1,3}(\.\d{1,3}){3}(/\d{1,2})?(-\d{1,3}(\.\d{1,3}){3})?$"
)
# "tcp/80", "udp/53", "any" 처럼 정책에 인라인으로 쓰는 서비스 리터럴도 갭 대상에서 제외
_SERVICE_LITERAL_RE = re.compile(r"^(tcp|udp)/[\d,\-]+$")


def _split_tokens(raw: str) -> List[str]:
    return [item.strip() for item in re.split(r"[,\n]", raw or "") if item.strip()]


def _is_address_literal(token: str) -> bool:
    if token.lower() == "any":
        return True
    return bool(_IP_LITERAL_RE.match(token))


def _is_service_literal(token: str) -> bool:
    lowered = token.lower()
    if lowered in ("any", "application-default"):
        # application-default는 PAN-OS 예약어(애플리케이션의 표준 포트 사용)이지 실제 서비스
        # 오브젝트가 아니므로 갭 감지 대상에서 제외한다.
        return True
    return bool(_SERVICE_LITERAL_RE.match(lowered))


async def find_missing_objects(db: AsyncSession, device_id: int, new_policies: List[NewPolicyRow]) -> List[ObjectGapItem]:
    """
    신규 정책들의 source/destination/service 토큰 중 DB(NetworkObject/NetworkGroup/Service/ServiceGroup)에
    없는 이름만 골라 종류별로 반환합니다. IP 리터럴/서비스 리터럴은 오브젝트 후보에서 제외합니다.
    """
    address_candidates: Dict[str, Set[str]] = {}
    service_candidates: Dict[str, Set[str]] = {}

    for row in new_policies:
        for raw in (row.source, row.destination):
            for token in _split_tokens(raw):
                if _is_address_literal(token):
                    continue
                address_candidates.setdefault(token, set()).add(row.rule_name)
        for token in _split_tokens(row.service):
            if _is_service_literal(token):
                continue
            service_candidates.setdefault(token, set()).add(row.rule_name)

    missing: List[ObjectGapItem] = []

    for name, rule_names in address_candidates.items():
        exists = await crud.network_object.get_network_object_by_name_and_device(db, device_id, name)
        if exists:
            continue
        exists_group = await crud.network_group.get_network_group_by_name_and_device(db, device_id, name)
        if exists_group:
            continue
        missing.append(ObjectGapItem(name=name, object_kind="address", referenced_by_rule_names=sorted(rule_names)))

    for name, rule_names in service_candidates.items():
        exists = await crud.service.get_service_by_name_and_device(db, device_id, name)
        if exists:
            continue
        exists_group = await crud.service_group.get_service_group_by_name_and_device(db, device_id, name)
        if exists_group:
            continue
        missing.append(ObjectGapItem(name=name, object_kind="service", referenced_by_rule_names=sorted(rule_names)))

    return missing
