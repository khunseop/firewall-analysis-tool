
import logging
import json
from typing import List, Dict, Any, Set, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import crud
from app.models import Policy, AnalysisTask
from app.services.analysis.risky_ports_models import RiskyPortDefinition
from app.services.analysis.risky_ports_utils import (
    parse_service_token,
    split_port_range,
    calculate_port_range_size,
)

logger = logging.getLogger(__name__)


class RiskyPortsAnalyzer:
    """
    위험 포트 분석을 수행하는 클래스입니다.

    수만 개의 위험 포트(Trojans, Malware 등) 데이터베이스와 정책의 서비스 포트를
    고속으로 매칭하여, 위험 포트가 포함된 정책을 식별하고 해결 방안을 제안합니다.
    """

    def __init__(self, db_session: AsyncSession, task: AnalysisTask, target_policy_ids: Optional[List[int]] = None):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.target_policy_ids = target_policy_ids
        self.risky_port_definitions: List[RiskyPortDefinition] = []
        self.service_resolver_cache: Dict[str, Set[str]] = {}
        self.service_group_map: Dict[str, List[str]] = {}
        self.service_value_map: Dict[str, Set[str]] = {}

    async def _load_risky_ports_setting(self) -> List[str]:
        """DB 설정 테이블에서 위험 포트 목록(JSON 형식)을 조회합니다."""
        setting = await crud.settings.get_setting(self.db, key="risky_ports")
        if not setting or not setting.value:
            logger.warning("위험 포트 설정이 없습니다.")
            return []
        try:
            risky_ports = json.loads(setting.value)
            if isinstance(risky_ports, list):
                return risky_ports
            logger.warning(f"위험 포트 설정 형식이 올바르지 않습니다: {setting.value}")
            return []
        except json.JSONDecodeError:
            logger.error(f"위험 포트 설정 JSON 파싱 실패: {setting.value}")
            return []

    async def _load_service_data(self):
        """장치에 등록된 모든 서비스 객체 및 그룹 데이터를 메모리에 로드합니다."""
        services = await crud.service.get_all_active_services_by_device(self.db, device_id=self.device_id)
        service_groups = await crud.service_group.get_all_active_service_groups_by_device(self.db, device_id=self.device_id)

        for s in services:
            proto = str(s.protocol or "").lower()
            port = str(s.port or "").replace(" ", "")
            if port and port != "none":
                tokens = {f"{proto}/{p.strip()}" for p in port.split(',')}
                self.service_value_map[s.name] = tokens

        for g in service_groups:
            members = [m.strip() for m in (g.members or "").split(',') if m.strip()]
            self.service_group_map[g.name] = members

    def _expand_service_groups(self, name: str, visited: Optional[Set[str]] = None) -> Set[str]:
        """
        서비스 그룹을 재귀적으로 확장하여 최종적인 포트 토큰 집합을 반환합니다.
        순환 참조를 방지하면서 하위 그룹을 끝까지 탐색합니다.
        """
        if name in self.service_resolver_cache:
            return self.service_resolver_cache[name]

        if visited is None:
            visited = set()
        if name in visited:
            return set()
        visited.add(name)

        if name in self.service_group_map:
            members = self.service_group_map[name]
            if not members:
                self.service_resolver_cache[name] = set()
                return set()
            expanded_tokens: Set[str] = set()
            for member_name in members:
                expanded_tokens.update(self._expand_service_groups(member_name, visited.copy()))
            self.service_resolver_cache[name] = expanded_tokens
            return expanded_tokens
        else:
            tokens = self.service_value_map.get(name, set())
            self.service_resolver_cache[name] = tokens
            return tokens

    def _get_service_group_members(self, group_name: str) -> List[str]:
        """서비스 그룹의 직계 멤버 목록을 반환합니다."""
        return self.service_group_map.get(group_name, [])

    def _check_service_has_risky_port(self, service_name: str, visited: Optional[Set[str]] = None) -> bool:
        """특정 서비스 또는 그룹에 위험 포트가 하나라도 포함되어 있는지 확인합니다."""
        if visited is None:
            visited = set()
        if service_name in visited:
            return False
        visited.add(service_name)

        if service_name in self.service_group_map:
            for member_name in self.service_group_map[service_name]:
                if self._check_service_has_risky_port(member_name, visited.copy()):
                    return True
            return False

        tokens = self.service_value_map.get(service_name, set())
        for token in tokens:
            protocol, p_start, p_end = parse_service_token(token)
            if protocol and p_start is not None and p_end is not None:
                if self._find_matching_risky_ports(protocol, p_start, p_end):
                    return True
        return False

    def _find_matching_risky_ports(
        self,
        protocol: Optional[str],
        port_start: Optional[int],
        port_end: Optional[int],
    ) -> List[RiskyPortDefinition]:
        """주어진 범위와 매칭되는 모든 위험 포트 정의를 찾아 반환합니다."""
        return [d for d in self.risky_port_definitions if d.matches(protocol, port_start, port_end)]

    def _create_safe_tokens_from_service_tokens(
        self,
        service_tokens: Set[str],
        removed_token_to_filtered: Dict[str, List[str]],
    ) -> List[str]:
        """원본 서비스 토큰에서 위험 포트 범위를 도려낸 '안전한 토큰' 리스트를 생성합니다."""
        safe_tokens = []
        for token in service_tokens:
            if token in removed_token_to_filtered:
                safe_tokens.extend(removed_token_to_filtered[token])
            else:
                protocol, p_start, p_end = parse_service_token(token)
                if protocol and p_start is not None and p_end is not None:
                    matching_risky = self._find_matching_risky_ports(protocol, p_start, p_end)
                    if matching_risky:
                        risky_ports_in_range = []
                        for risky_def in matching_risky:
                            for port in range(max(p_start, risky_def.port_start),
                                             min(p_end, risky_def.port_end) + 1):
                                risky_ports_in_range.append(port)
                        for safe_range in split_port_range(protocol, p_start, p_end, risky_ports_in_range):
                            if safe_range["port_start"] == safe_range["port_end"]:
                                safe_tokens.append(f"{safe_range['protocol']}/{safe_range['port_start']}")
                            else:
                                safe_tokens.append(f"{safe_range['protocol']}/{safe_range['port_start']}-{safe_range['port_end']}")
                    else:
                        safe_tokens.append(token)
                else:
                    safe_tokens.append(token)
        return list(set(safe_tokens))

    async def _get_policies_with_members(self) -> List[Policy]:
        """분석 대상 정책을 조회합니다."""
        logger.info("분석 대상 정책 데이터 조회 시작...")
        stmt = (
            select(Policy)
            .where(Policy.device_id == self.device_id)
            .options(selectinload(Policy.service_members))
            .order_by(Policy.seq)
        )
        if self.target_policy_ids:
            stmt = stmt.where(Policy.id.in_(self.target_policy_ids))
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def analyze(self) -> List[Dict[str, Any]]:
        """
        위험 포트 분석 알고리즘의 메인 실행부입니다.

        과정:
        1. 위험 포트 정의 DB 로드 및 파싱.
        2. 방화벽 서비스 객체/그룹 구조 파싱 및 메모리 인덱싱.
        3. 각 정책의 서비스 포트 정보를 추출하여 위험 포트 DB와 교차 검증.
        4. 위험 포트 발견 시, 해당 포트만 제거한 'Safe 서비스 객체'와 '수정 권고 스크립트' 생성.
        5. 분석 전후의 포트 개수 변화량 계산.
        """
        logger.info(f"Task ID {self.task.id}에 대한 위험 포트 정책 분석 시작.")

        risky_port_strings = await self._load_risky_ports_setting()
        if not risky_port_strings:
            return []

        self.risky_port_definitions = [RiskyPortDefinition(rp) for rp in risky_port_strings]
        await self._load_service_data()
        policies = await self._get_policies_with_members()
        return await self._analyze_policies(policies)

    async def _analyze_policies(self, policies: List[Policy]) -> List[Dict[str, Any]]:
        """정책 목록 전체에 대해 위험 포트 분석을 수행하고 결과를 반환합니다."""
        results = []

        for policy in policies:
            removed_risky_ports = []
            original_service_tokens: Set[str] = set()
            original_service_objects = []
            filtered_service_tokens = []
            filtered_service_objects = []
            service_group_recommendations = []
            removed_token_to_filtered: Dict[str, List[str]] = {}

            original_service_names = []
            if policy.service:
                original_service_names = [s.strip() for s in policy.service.split(',') if s.strip()]

            processed_service_names: Set[str] = set()
            for service_name in original_service_names:
                if service_name in processed_service_names:
                    continue
                processed_service_names.add(service_name)

                if service_name in self.service_group_map:
                    expanded_tokens = self._expand_service_groups(service_name)
                    original_service_tokens.update(expanded_tokens)
                    original_service_objects.append({
                        "type": "group",
                        "name": service_name,
                        "expanded_tokens": list(expanded_tokens),
                        "members": self._get_service_group_members(service_name),
                    })
                elif service_name in self.service_value_map:
                    tokens = self.service_value_map[service_name]
                    original_service_tokens.update(tokens)
                    has_any_token = any(t.lower() == 'any' for t in tokens)
                    original_service_objects.append({
                        "type": "service",
                        "name": service_name,
                        "token": service_name,
                        "is_any": has_any_token,
                    })
                else:
                    protocol, p_start, p_end = parse_service_token(service_name)
                    if protocol and p_start is not None and p_end is not None:
                        if protocol.lower() == 'any':
                            original_service_tokens.add(f"tcp/{p_start}-{p_end}")
                            original_service_tokens.add(f"udp/{p_start}-{p_end}")
                        else:
                            token_str = f"{protocol}/{p_start}" if p_start == p_end else f"{protocol}/{p_start}-{p_end}"
                            original_service_tokens.add(token_str)
                        original_service_objects.append({
                            "type": "service",
                            "name": service_name,
                            "token": service_name,
                            "is_any": protocol.lower() == 'any' if protocol else False,
                        })

            for service_member in policy.service_members:
                token = service_member.token
                token_type = service_member.token_type
                protocol = service_member.protocol
                port_start = service_member.port_start
                port_end = service_member.port_end

                if (token_type == 'any' or (protocol and protocol.lower() == 'any')) and port_start is not None and port_end is not None:
                    service_name = self._find_service_name_for_token(token, original_service_objects)
                    for proto in ['tcp', 'udp']:
                        matching_risky = self._find_matching_risky_ports(proto, port_start, port_end)
                        if matching_risky:
                            risky_ports_in_range = self._collect_risky_ports_in_range(proto, port_start, port_end, matching_risky)
                            for risky_def in matching_risky:
                                overlap_start = max(port_start, risky_def.port_start)
                                overlap_end = min(port_end, risky_def.port_end)
                                if overlap_start <= overlap_end:
                                    removed_risky_ports.append(self._make_removed_entry(proto, overlap_start, overlap_end, risky_def, token, service_name))
                            self._apply_split_to_filtered(proto, port_start, port_end, risky_ports_in_range, token, filtered_service_tokens, removed_token_to_filtered)
                        else:
                            safe_token = f"{proto}/{port_start}-{port_end}"
                            filtered_service_tokens.append(safe_token)
                            removed_token_to_filtered.setdefault(token, []).append(safe_token)

                elif protocol and port_start is not None and port_end is not None:
                    matching_risky = self._find_matching_risky_ports(protocol, port_start, port_end)
                    if matching_risky:
                        risky_ports_in_range = self._collect_risky_ports_in_range(protocol, port_start, port_end, matching_risky)
                        service_name = self._find_service_name_for_token(token, original_service_objects)
                        for risky_def in matching_risky:
                            overlap_start = max(port_start, risky_def.port_start)
                            overlap_end = min(port_end, risky_def.port_end)
                            if overlap_start <= overlap_end:
                                removed_risky_ports.append(self._make_removed_entry(protocol, overlap_start, overlap_end, risky_def, token, service_name))
                        self._apply_split_to_filtered(protocol, port_start, port_end, risky_ports_in_range, token, filtered_service_tokens, removed_token_to_filtered)
                    else:
                        filtered_service_tokens.append(token)

            services_with_removed_ports = {rp["service_name"] for rp in removed_risky_ports if rp.get("service_name")}
            self._build_filtered_service_objects(
                original_service_objects, filtered_service_objects,
                removed_risky_ports, removed_token_to_filtered, services_with_removed_ports,
            )
            self._build_service_group_recommendations(
                original_service_objects, removed_risky_ports,
                filtered_service_tokens, service_group_recommendations,
            )

            original_port_range_size = calculate_port_range_size(list(original_service_tokens))
            filtered_port_range_size = calculate_port_range_size(filtered_service_tokens)
            removed_port_tokens = self._build_removed_port_tokens(removed_risky_ports)
            removed_port_range_size = calculate_port_range_size(removed_port_tokens)

            results.append({
                "policy": policy,
                "removed_risky_ports": removed_risky_ports,
                "original_services": list(original_service_tokens),
                "original_service_objects": original_service_objects,
                "filtered_services": filtered_service_tokens,
                "filtered_service_objects": filtered_service_objects,
                "service_group_recommendations": service_group_recommendations,
                "original_port_range_size": original_port_range_size,
                "removed_port_range_size": removed_port_range_size,
                "filtered_port_range_size": filtered_port_range_size,
            })

        logger.info(f"{len(results)}개의 정책이 분석되었습니다.")
        return results

    # ------------------------------------------------------------------ helpers

    def _find_service_name_for_token(self, token: str, original_service_objects: List[Dict]) -> Optional[str]:
        for obj in original_service_objects:
            if obj["type"] == "group":
                if token in obj.get("expanded_tokens", []):
                    return obj["name"]
            elif obj["type"] == "service":
                if token == obj.get("token") or token in self.service_value_map.get(obj["name"], set()):
                    return obj["name"]
        return None

    def _collect_risky_ports_in_range(
        self, protocol: str, port_start: int, port_end: int, matching_risky: List[RiskyPortDefinition]
    ) -> List[int]:
        risky_ports: List[int] = []
        for risky_def in matching_risky:
            for port in range(max(port_start, risky_def.port_start), min(port_end, risky_def.port_end) + 1):
                risky_ports.append(port)
        return risky_ports

    def _make_removed_entry(
        self, protocol: str, overlap_start: int, overlap_end: int,
        risky_def: RiskyPortDefinition, token: str, service_name: Optional[str],
    ) -> Dict[str, Any]:
        return {
            "protocol": protocol,
            "port": f"{overlap_start}" if overlap_start == overlap_end else f"{overlap_start}-{overlap_end}",
            "port_range": f"{overlap_start}-{overlap_end}",
            "risky_port_def": risky_def.definition,
            "service_token": token,
            "service_name": service_name,
        }

    def _apply_split_to_filtered(
        self, protocol: str, port_start: int, port_end: int,
        risky_ports_in_range: List[int], token: str,
        filtered_service_tokens: List[str],
        removed_token_to_filtered: Dict[str, List[str]],
    ):
        filtered_from_this: List[str] = []
        for safe_range in split_port_range(protocol, port_start, port_end, risky_ports_in_range):
            if safe_range["port_start"] == safe_range["port_end"]:
                ft = f"{safe_range['protocol']}/{safe_range['port_start']}"
            else:
                ft = f"{safe_range['protocol']}/{safe_range['port_start']}-{safe_range['port_end']}"
            filtered_service_tokens.append(ft)
            filtered_from_this.append(ft)
        removed_token_to_filtered.setdefault(token, []).extend(filtered_from_this)

    def _build_filtered_service_objects(
        self,
        original_service_objects: List[Dict],
        filtered_service_objects: List[Dict],
        removed_risky_ports: List[Dict],
        removed_token_to_filtered: Dict[str, List[str]],
        services_with_removed_ports: Set[str],
    ):
        """개별 서비스 및 그룹에 대한 filtered_service_objects를 구성합니다."""
        # 개별 서비스 처리
        for obj in original_service_objects:
            if obj["type"] != "service":
                continue
            service_name = obj["name"]
            service_token = obj.get("token", service_name)
            service_has_removed = self._service_has_removed_ports(
                service_name, service_token, removed_risky_ports, removed_token_to_filtered
            )
            is_any_service = obj.get("is_any", False) or service_name.lower() == 'any' or service_token.lower() == 'any'

            if service_has_removed:
                if is_any_service:
                    for proto in ['tcp', 'udp']:
                        proto_tokens = self._get_proto_tokens_for_any(proto, service_token, removed_token_to_filtered)
                        if proto_tokens:
                            filtered_service_objects.append({
                                "type": "service",
                                "name": f"{proto.upper()}-0-65535_Safe",
                                "original_name": service_name,
                                "token": service_token,
                                "filtered_tokens": proto_tokens,
                            })
                elif service_name in self.service_value_map:
                    safe_tokens = self._create_safe_tokens_from_service_tokens(
                        self.service_value_map[service_name], removed_token_to_filtered
                    )
                    if safe_tokens:
                        filtered_service_objects.append({
                            "type": "service",
                            "name": f"{service_name}_Safe",
                            "original_name": service_name,
                            "token": service_token,
                            "filtered_tokens": safe_tokens,
                        })
                else:
                    safe_tokens = removed_token_to_filtered.get(service_token) or \
                        self._create_safe_tokens_from_service_tokens({service_token}, removed_token_to_filtered)
                    if safe_tokens:
                        filtered_service_objects.append({
                            "type": "service",
                            "name": f"{service_name}_Safe",
                            "original_name": service_name,
                            "token": service_token,
                            "filtered_tokens": safe_tokens,
                        })
            else:
                if is_any_service:
                    for proto in ['tcp', 'udp']:
                        filtered_service_objects.append({
                            "type": "service",
                            "name": f"{proto.upper()}-0-65535_Safe",
                            "original_name": service_name,
                            "token": service_token,
                            "filtered_tokens": [f"{proto}/0-65535"],
                        })
                else:
                    original_tokens = list(self.service_value_map.get(service_name, {service_token}))
                    filtered_service_objects.append({
                        "type": "service",
                        "name": service_name,
                        "original_name": service_name,
                        "token": service_token,
                        "filtered_tokens": original_tokens,
                    })

        # 그룹 처리
        for obj in original_service_objects:
            if obj["type"] != "group":
                continue
            group_name = obj["name"]
            original_expanded_tokens = set(obj.get("expanded_tokens", []))
            group_members = obj.get("members", [])
            group_has_removed = group_name in services_with_removed_ports
            group_members_have_risky = any(self._check_service_has_risky_port(m) for m in group_members)

            if group_has_removed or group_members_have_risky:
                group_filtered_tokens = self._compute_group_filtered_tokens(
                    original_expanded_tokens, removed_token_to_filtered
                )
                group_filtered_tokens = list(set(group_filtered_tokens))
                if group_filtered_tokens:
                    safe_group_name = f"{group_name}_Safe"
                    created_safe = {o["name"] for o in filtered_service_objects if o.get("name", "").endswith("_Safe")}
                    filtered_members, safe_member_objects = self._build_safe_group_members(
                        group_name, safe_group_name, group_members, services_with_removed_ports,
                        removed_token_to_filtered, created_safe
                    )
                    filtered_service_objects.extend(safe_member_objects)
                    filtered_service_objects.append({
                        "type": "group",
                        "name": safe_group_name,
                        "original_name": group_name,
                        "filtered_tokens": group_filtered_tokens,
                        "members": group_members,
                        "filtered_members": filtered_members,
                    })
            else:
                filtered_service_objects.append({
                    "type": "group",
                    "name": group_name,
                    "original_name": group_name,
                    "filtered_tokens": list(original_expanded_tokens),
                    "members": group_members,
                })

    def _service_has_removed_ports(
        self, service_name: str, service_token: str,
        removed_risky_ports: List[Dict],
        removed_token_to_filtered: Dict[str, List[str]],
    ) -> bool:
        for rp in removed_risky_ports:
            if rp.get("service_name") == service_name or rp.get("service_token") == service_token:
                return True
        if service_name in self.service_value_map:
            if any(t in removed_token_to_filtered for t in self.service_value_map[service_name]):
                return True
        if service_token in removed_token_to_filtered:
            return True
        return False

    def _get_proto_tokens_for_any(
        self, proto: str, service_token: str, removed_token_to_filtered: Dict[str, List[str]]
    ) -> List[str]:
        if service_token in removed_token_to_filtered:
            proto_tokens = [t for t in removed_token_to_filtered[service_token] if t.startswith(f"{proto}/")]
            return proto_tokens or [f"{proto}/0-65535"]
        matching_risky = self._find_matching_risky_ports(proto, 0, 65535)
        if matching_risky:
            risky_ports = self._collect_risky_ports_in_range(proto, 0, 65535, matching_risky)
            proto_tokens = []
            for sr in split_port_range(proto, 0, 65535, risky_ports):
                if sr["port_start"] == sr["port_end"]:
                    proto_tokens.append(f"{proto}/{sr['port_start']}")
                else:
                    proto_tokens.append(f"{proto}/{sr['port_start']}-{sr['port_end']}")
            return proto_tokens
        return [f"{proto}/0-65535"]

    def _compute_group_filtered_tokens(
        self, original_expanded_tokens: Set[str], removed_token_to_filtered: Dict[str, List[str]]
    ) -> List[str]:
        group_filtered: List[str] = []
        for original_token in original_expanded_tokens:
            if original_token in removed_token_to_filtered:
                group_filtered.extend(removed_token_to_filtered[original_token])
            else:
                protocol, p_start, p_end = parse_service_token(original_token)
                if protocol and p_start is not None and p_end is not None:
                    matching_risky = self._find_matching_risky_ports(protocol, p_start, p_end)
                    if matching_risky:
                        risky_in_range = self._collect_risky_ports_in_range(protocol, p_start, p_end, matching_risky)
                        for sr in split_port_range(protocol, p_start, p_end, risky_in_range):
                            if sr["port_start"] == sr["port_end"]:
                                group_filtered.append(f"{sr['protocol']}/{sr['port_start']}")
                            else:
                                group_filtered.append(f"{sr['protocol']}/{sr['port_start']}-{sr['port_end']}")
                    else:
                        group_filtered.append(original_token)
                else:
                    group_filtered.append(original_token)
        return group_filtered

    def _build_safe_group_members(
        self, group_name: str, safe_group_name: str, group_members: List[str],
        services_with_removed_ports: Set[str],
        removed_token_to_filtered: Dict[str, List[str]],
        created_safe: Set[str],
    ):
        filtered_members: List[str] = []
        risky_members: List[str] = []
        safe_member_objects: List[Dict] = []

        for member_name in group_members:
            member_has_risky = (
                member_name in services_with_removed_ports
                or self._check_service_has_risky_port(member_name)
            )
            if member_has_risky:
                risky_members.append(member_name)
                if member_name in self.service_value_map:
                    safe_member_name = f"{member_name}_Safe"
                    if safe_member_name in created_safe:
                        filtered_members.append(safe_member_name)
                    else:
                        safe_tokens = self._create_safe_tokens_from_service_tokens(
                            self.service_value_map[member_name], removed_token_to_filtered
                        )
                        if safe_tokens:
                            filtered_members.append(safe_member_name)
                            safe_member_objects.append({
                                "type": "service",
                                "name": safe_member_name,
                                "original_name": member_name,
                                "token": member_name,
                                "filtered_tokens": safe_tokens,
                            })
                            created_safe.add(safe_member_name)
                elif member_name in self.service_group_map:
                    logger.info(f"그룹 {safe_group_name}의 멤버 {member_name}: 위험 포트를 포함한 서비스 그룹으로 제외됨")
                else:
                    logger.warning(f"그룹 {safe_group_name}의 멤버 {member_name}: 알 수 없는 멤버 타입으로 제외됨")
            else:
                filtered_members.append(member_name)

        if not filtered_members:
            logger.warning(f"그룹 {safe_group_name}의 filtered_members가 비어있습니다. 원본={group_members}, 위험={risky_members}")

        return filtered_members, safe_member_objects

    def _build_service_group_recommendations(
        self,
        original_service_objects: List[Dict],
        removed_risky_ports: List[Dict],
        filtered_service_tokens: List[str],
        service_group_recommendations: List[Dict],
    ):
        for obj in original_service_objects:
            if obj["type"] != "group":
                continue
            group_name = obj["name"]
            group_members = self._get_service_group_members(group_name)
            group_removed_ports = [r for r in removed_risky_ports if r.get("service_name") == group_name]
            if not (group_removed_ports and group_members):
                continue
            safe_members = [m for m in group_members if not self._check_service_has_risky_port(m)]
            risky_members = [m for m in group_members if self._check_service_has_risky_port(m)]
            group_filtered_tokens = [t for t in filtered_service_tokens if t in obj.get("expanded_tokens", [])]
            filtered_service_names = [f"{group_name}_filtered"] if group_filtered_tokens else []
            recommendation = {
                "original_group_name": group_name,
                "can_use_original": len(safe_members) > 0,
                "safe_members": safe_members,
                "risky_members": risky_members,
                "new_group_suggestion": {
                    "name": f"{group_name}_safe",
                    "members": safe_members + filtered_service_names if safe_members else filtered_service_names,
                } if (safe_members or filtered_service_names) else None,
            }
            service_group_recommendations.append(recommendation)

    def _build_removed_port_tokens(self, removed_risky_ports: List[Dict]) -> List[str]:
        tokens = []
        for rp in removed_risky_ports:
            port_range = rp.get("port_range", "")
            protocol = rp.get("protocol", "")
            if port_range and protocol:
                if '-' in port_range:
                    p_start, p_end = map(int, port_range.split('-'))
                else:
                    p_start = p_end = int(port_range)
                tokens.append(f"{protocol}/{p_start}-{p_end}" if p_start != p_end else f"{protocol}/{p_start}")
        return tokens
