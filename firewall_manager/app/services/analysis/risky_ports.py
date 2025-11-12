
import logging
import json
import re
from typing import List, Dict, Any, Set, Tuple, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import crud
from app.models import Policy, AnalysisTask, Service, ServiceGroup
from app.services.normalize import parse_port_numeric

logger = logging.getLogger(__name__)


class RiskyPortDefinition:
    """위험 포트 정의를 파싱하고 저장하는 클래스"""
    
    def __init__(self, definition: str):
        """
        위험 포트 정의 파싱
        형식: tcp/80 또는 tcp/10-15
        """
        self.definition = definition.strip()
        self.protocol = None
        self.port_start = None
        self.port_end = None
        
        # 파싱
        if '/' in self.definition:
            parts = self.definition.split('/', 1)
            self.protocol = parts[0].strip().lower()
            port_str = parts[1].strip()
            
            if '-' in port_str:
                # 범위 형식: tcp/10-15
                port_parts = port_str.split('-', 1)
                try:
                    self.port_start = int(port_parts[0].strip())
                    self.port_end = int(port_parts[1].strip())
                except ValueError:
                    logger.warning(f"Invalid port range format: {port_str}")
            else:
                # 단일 포트: tcp/80
                try:
                    port = int(port_str)
                    self.port_start = port
                    self.port_end = port
                except ValueError:
                    logger.warning(f"Invalid port format: {port_str}")
    
    def matches(self, protocol: Optional[str], port_start: Optional[int], port_end: Optional[int]) -> bool:
        """
        주어진 프로토콜/포트 범위가 이 위험 포트 정의와 매칭되는지 확인
        프로토콜이 일치하고 포트 범위가 겹치는지 확인
        """
        if not protocol or port_start is None or port_end is None:
            return False
        
        # 프로토콜 일치 확인
        if self.protocol != protocol.lower():
            return False
        
        # 포트 범위 겹침 확인
        return not (port_end < self.port_start or port_start > self.port_end)
    
    def __repr__(self):
        return f"RiskyPortDefinition({self.definition})"


class RiskyPortsAnalyzer:
    """위험 포트 정책 분석을 위한 클래스"""
    
    def __init__(self, db_session: AsyncSession, task: AnalysisTask):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.risky_port_definitions: List[RiskyPortDefinition] = []
        self.service_resolver_cache: Dict[str, Set[str]] = {}
        self.service_group_map: Dict[str, List[str]] = {}
        self.service_value_map: Dict[str, Set[str]] = {}
    
    async def _load_risky_ports_setting(self) -> List[str]:
        """위험 포트 설정을 조회합니다."""
        setting = await crud.settings.get_setting(self.db, key="risky_ports")
        if not setting or not setting.value:
            logger.warning("위험 포트 설정이 없습니다.")
            return []
        
        try:
            risky_ports = json.loads(setting.value)
            if isinstance(risky_ports, list):
                return risky_ports
            else:
                logger.warning(f"위험 포트 설정 형식이 올바르지 않습니다: {setting.value}")
                return []
        except json.JSONDecodeError:
            logger.error(f"위험 포트 설정 JSON 파싱 실패: {setting.value}")
            return []
    
    async def _load_service_data(self):
        """서비스 객체와 서비스 그룹 데이터를 로드합니다."""
        services = await crud.service.get_all_active_services_by_device(self.db, device_id=self.device_id)
        service_groups = await crud.service_group.get_all_active_service_groups_by_device(self.db, device_id=self.device_id)
        
        # 서비스 값 맵 생성 (서비스명 -> 포트 토큰 집합)
        for s in services:
            proto = str(s.protocol or "").lower()
            port = str(s.port or "").replace(" ", "")
            if port and port != "none":
                tokens = {f"{proto}/{p.strip()}" for p in port.split(',')}
                self.service_value_map[s.name] = tokens
        
        # 서비스 그룹 맵 생성
        for g in service_groups:
            members = [m.strip() for m in (g.members or "").split(',') if m.strip()]
            self.service_group_map[g.name] = members
    
    def _expand_service_groups(self, name: str, visited: Optional[Set[str]] = None) -> Set[str]:
        """
        서비스 그룹을 재귀적으로 확장하여 최종 포트 토큰 집합을 반환
        policy_indexer.py의 Resolver._expand_groups 로직 참고
        """
        if name in self.service_resolver_cache:
            return self.service_resolver_cache[name]
        
        # 순환 참조 방지
        if visited is None:
            visited = set()
        if name in visited:
            return set()
        visited.add(name)
        
        # 서비스 그룹인 경우
        if name in self.service_group_map:
            members = self.service_group_map[name]
            if not members:
                # 빈 그룹
                self.service_resolver_cache[name] = set()
                return set()
            
            # 그룹 멤버들을 재귀적으로 확장
            expanded_tokens: Set[str] = set()
            for member_name in members:
                member_tokens = self._expand_service_groups(member_name, visited.copy())
                expanded_tokens.update(member_tokens)
            
            self.service_resolver_cache[name] = expanded_tokens
            return expanded_tokens
        else:
            # 서비스 객체인 경우
            tokens = self.service_value_map.get(name, set())
            self.service_resolver_cache[name] = tokens
            return tokens
    
    def _get_service_group_members(self, group_name: str) -> List[str]:
        """서비스 그룹의 멤버 목록을 반환"""
        return self.service_group_map.get(group_name, [])
    
    def _check_service_has_risky_port(self, service_name: str, visited: Optional[Set[str]] = None) -> bool:
        """
        서비스 객체 또는 서비스 그룹에 위험 포트가 포함되어 있는지 확인
        서비스 그룹인 경우 재귀적으로 멤버들을 확인
        """
        # 순환 참조 방지
        if visited is None:
            visited = set()
        if service_name in visited:
            return False
        visited.add(service_name)
        
        # 서비스 그룹인 경우 멤버들을 재귀적으로 확인
        if service_name in self.service_group_map:
            members = self.service_group_map[service_name]
            for member_name in members:
                if self._check_service_has_risky_port(member_name, visited.copy()):
                    return True
            return False
        
        # 개별 서비스 객체인 경우
        tokens = self.service_value_map.get(service_name, set())
        for token in tokens:
            protocol, port_start, port_end = self._parse_service_token(token)
            if protocol and port_start is not None and port_end is not None:
                matching_risky = self._find_matching_risky_ports(protocol, port_start, port_end)
                if matching_risky:
                    return True
        return False
    
    def _parse_service_token(self, token: str) -> Tuple[Optional[str], Optional[int], Optional[int]]:
        """
        서비스 토큰을 파싱하여 프로토콜, 포트 시작, 포트 끝을 반환
        예: "tcp/80" -> ("tcp", 80, 80)
        예: "tcp/10-15" -> ("tcp", 10, 15)
        """
        token_lower = token.lower()
        if '/' in token_lower:
            parts = token_lower.split('/', 1)
            protocol = parts[0].strip()
            port_str = parts[1].strip()
            
            port_start, port_end = parse_port_numeric(port_str)
            return protocol, port_start, port_end
        elif token_lower == 'any':
            return 'any', 0, 65535
        
        return None, None, None
    
    def _find_matching_risky_ports(
        self, 
        protocol: Optional[str], 
        port_start: Optional[int], 
        port_end: Optional[int]
    ) -> List[RiskyPortDefinition]:
        """주어진 프로토콜/포트 범위와 매칭되는 위험 포트 정의들을 반환"""
        matching = []
        for risky_def in self.risky_port_definitions:
            if risky_def.matches(protocol, port_start, port_end):
                matching.append(risky_def)
        return matching
    
    def _create_safe_tokens_from_service_tokens(
        self,
        service_tokens: Set[str],
        removed_token_to_filtered: Dict[str, List[str]]
    ) -> List[str]:
        """
        서비스 토큰들로부터 Safe 토큰 리스트 생성
        removed_token_to_filtered를 먼저 확인하고, 없으면 위험 포트를 재검사
        """
        safe_tokens = []
        for token in service_tokens:
            if token in removed_token_to_filtered:
                # 이미 필터링된 토큰 사용
                safe_tokens.extend(removed_token_to_filtered[token])
            else:
                # removed_token_to_filtered에 없어도 위험 포트를 다시 검사
                protocol, port_start, port_end = self._parse_service_token(token)
                if protocol and port_start is not None and port_end is not None:
                    matching_risky = self._find_matching_risky_ports(protocol, port_start, port_end)
                    if matching_risky:
                        # 위험 포트가 포함된 범위에서 제거
                        risky_ports_in_range = []
                        for risky_def in matching_risky:
                            for port in range(max(port_start, risky_def.port_start), 
                                             min(port_end, risky_def.port_end) + 1):
                                risky_ports_in_range.append(port)
                        
                        # 안전한 범위로 분리
                        safe_ranges = self._split_port_range(protocol, port_start, port_end, risky_ports_in_range)
                        for safe_range in safe_ranges:
                            if safe_range["port_start"] == safe_range["port_end"]:
                                safe_token = f"{safe_range['protocol']}/{safe_range['port_start']}"
                            else:
                                safe_token = f"{safe_range['protocol']}/{safe_range['port_start']}-{safe_range['port_end']}"
                            safe_tokens.append(safe_token)
                    else:
                        # 위험 포트가 없으면 그대로 유지
                        safe_tokens.append(token)
                else:
                    # 파싱 실패한 토큰은 그대로 유지
                    safe_tokens.append(token)
        return list(set(safe_tokens))
    
    def _split_port_range(
        self, 
        protocol: str, 
        port_start: int, 
        port_end: int, 
        risky_ports_in_range: List[int]
    ) -> List[Dict[str, Any]]:
        """
        포트 범위에서 위험 포트를 제거하고 안전한 범위들로 분리
        예: tcp/10-15에서 [12, 14] 제거 -> [tcp/10-11, tcp/13, tcp/15]
        """
        if not risky_ports_in_range:
            # 위험 포트가 없으면 원본 범위 반환
            return [{"protocol": protocol, "port_start": port_start, "port_end": port_end}]
        
        # 위험 포트를 포함한 모든 포트를 정렬
        risky_ports_sorted = sorted(set(risky_ports_in_range))
        
        # 안전한 범위들 생성
        safe_ranges = []
        current_start = port_start
        
        for risky_port in risky_ports_sorted:
            if risky_port < port_start:
                continue
            if risky_port > port_end:
                break
            
            # 위험 포트 이전까지의 안전한 범위 추가
            if current_start < risky_port:
                safe_ranges.append({
                    "protocol": protocol,
                    "port_start": current_start,
                    "port_end": risky_port - 1
                })
            
            # 다음 안전한 범위 시작점 설정
            current_start = risky_port + 1
        
        # 마지막 위험 포트 이후의 안전한 범위 추가
        if current_start <= port_end:
            safe_ranges.append({
                "protocol": protocol,
                "port_start": current_start,
                "port_end": port_end
            })
        
        return safe_ranges
    
    async def _get_policies_with_members(self) -> List[Policy]:
        """분석에 필요한 정책과 멤버 데이터를 DB에서 조회합니다."""
        logger.info("분석 대상 정책 데이터 조회 시작...")
        stmt = (
            select(Policy)
            .where(
                Policy.device_id == self.device_id
            )
            .options(
                selectinload(Policy.service_members)
            )
            .order_by(Policy.seq)
        )
        result = await self.db.execute(stmt)
        policies = result.scalars().all()
        logger.info(f"총 {len(policies)}개의 정책이 조회되었습니다 (활성화/비활성화 포함).")
        return policies
    
    async def analyze(self) -> List[Dict[str, Any]]:
        """위험 포트 정책 분석을 실행하고 결과를 반환합니다."""
        logger.info(f"Task ID {self.task.id}에 대한 위험 포트 정책 분석 시작.")
        
        # 1. 위험 포트 설정 로드
        risky_port_strings = await self._load_risky_ports_setting()
        if not risky_port_strings:
            logger.warning("위험 포트 설정이 없어 분석을 중단합니다.")
            return []
        
        # 위험 포트 정의 파싱
        self.risky_port_definitions = [RiskyPortDefinition(rp) for rp in risky_port_strings]
        logger.info(f"{len(self.risky_port_definitions)}개의 위험 포트 정의가 로드되었습니다.")
        
        # 2. 서비스 데이터 로드
        await self._load_service_data()
        
        # 3. 정책 조회
        policies = await self._get_policies_with_members()
        
        results = []
        
        for policy in policies:
            removed_risky_ports = []
            original_service_tokens = set()
            original_service_objects = []  # 원본 서비스 객체 정보 (그룹/개별 구분)
            filtered_service_tokens = []
            filtered_service_objects = []  # 제거 후 서비스 객체 정보 (그룹/개별 구분)
            service_group_recommendations = []
            # 위험 포트가 제거된 원본 토큰 -> 필터된 토큰 매핑
            removed_token_to_filtered = {}  # {원본토큰: [필터된토큰1, 필터된토큰2, ...]}
            
            # policy.service 필드에서 원본 서비스 이름 목록 파싱 (그룹/개별 구분)
            original_service_names = []
            if policy.service:
                original_service_names = [s.strip() for s in policy.service.split(',') if s.strip()]
            
            # 원본 서비스 이름들을 그룹/개별로 분류하여 original_service_objects에 추가
            processed_service_names = set()  # 이미 처리된 서비스 이름 추적
            for service_name in original_service_names:
                if service_name in processed_service_names:
                    continue
                processed_service_names.add(service_name)
                
                # 서비스 그룹인지 확인
                if service_name in self.service_group_map:
                    # 서비스 그룹인 경우
                    expanded_tokens = self._expand_service_groups(service_name)
                    original_service_tokens.update(expanded_tokens)
                    group_members = self._get_service_group_members(service_name)
                    original_service_objects.append({
                        "type": "group",
                        "name": service_name,
                        "expanded_tokens": list(expanded_tokens),
                        "members": group_members
                    })
                elif service_name in self.service_value_map:
                    # 개별 서비스 객체인 경우
                    tokens = self.service_value_map[service_name]
                    original_service_tokens.update(tokens)
                    original_service_objects.append({
                        "type": "service",
                        "name": service_name,
                        "token": service_name
                    })
                else:
                    # 직접 프로토콜/포트 형식인 경우 (예: "tcp/80")
                    # 파싱하여 토큰 추가
                    protocol, port_start, port_end = self._parse_service_token(service_name)
                    if protocol and port_start is not None and port_end is not None:
                        token_str = f"{protocol}/{port_start}" if port_start == port_end else f"{protocol}/{port_start}-{port_end}"
                        original_service_tokens.add(token_str)
                        original_service_objects.append({
                            "type": "service",
                            "name": service_name,
                            "token": service_name
                        })
            
            # 정책의 서비스 멤버 처리 (확장된 토큰들)
            for service_member in policy.service_members:
                token = service_member.token
                token_type = service_member.token_type
                protocol = service_member.protocol
                port_start = service_member.port_start
                port_end = service_member.port_end
                
                # service_members는 확장된 토큰들이므로 위험 포트 검사 및 필터링에만 사용
                # original_service_objects는 이미 policy.service에서 파싱한 정보 사용
                if protocol and port_start is not None and port_end is not None:
                    # 위험 포트 매칭 확인
                    matching_risky = self._find_matching_risky_ports(protocol, port_start, port_end)
                    if matching_risky:
                        # 위험 포트가 포함된 범위에서 제거
                        risky_ports_in_range = []
                        for risky_def in matching_risky:
                            for port in range(max(port_start, risky_def.port_start), 
                                             min(port_end, risky_def.port_end) + 1):
                                risky_ports_in_range.append(port)
                        
                        # 원본 서비스 이름 찾기 (token이 어떤 서비스 객체/그룹에서 왔는지)
                        service_name = None
                        for obj in original_service_objects:
                            if obj["type"] == "group":
                                if token in obj.get("expanded_tokens", []):
                                    service_name = obj["name"]
                                    break
                            elif obj["type"] == "service":
                                if token == obj.get("token") or token in self.service_value_map.get(obj["name"], set()):
                                    service_name = obj["name"]
                                    break
                        
                        # 매칭된 모든 위험 포트 정의를 포함하도록 수정
                        # 각 위험 포트 정의마다 별도 항목 추가
                        for risky_def in matching_risky:
                            # 이 위험 포트 정의와 겹치는 포트 범위 계산
                            overlap_start = max(port_start, risky_def.port_start)
                            overlap_end = min(port_end, risky_def.port_end)
                            
                            if overlap_start <= overlap_end:
                                removed_risky_ports.append({
                                    "protocol": protocol,
                                    "port": f"{overlap_start}" if overlap_start == overlap_end else f"{overlap_start}-{overlap_end}",
                                    "port_range": f"{overlap_start}-{overlap_end}",
                                    "risky_port_def": risky_def.definition,
                                    "service_token": token,
                                    "service_name": service_name
                                })
                        
                        # 안전한 범위로 분리
                        safe_ranges = self._split_port_range(protocol, port_start, port_end, risky_ports_in_range)
                        filtered_from_this_token = []
                        for safe_range in safe_ranges:
                            if safe_range["port_start"] == safe_range["port_end"]:
                                filtered_token = f"{safe_range['protocol']}/{safe_range['port_start']}"
                            else:
                                filtered_token = f"{safe_range['protocol']}/{safe_range['port_start']}-{safe_range['port_end']}"
                            filtered_service_tokens.append(filtered_token)
                            filtered_from_this_token.append(filtered_token)
                        
                        # 원본 토큰 -> 필터된 토큰 매핑 저장
                        if token not in removed_token_to_filtered:
                            removed_token_to_filtered[token] = []
                        removed_token_to_filtered[token].extend(filtered_from_this_token)
                    else:
                        # 위험 포트가 없으면 그대로 추가
                        filtered_service_tokens.append(token)
            
            # 제거 후 서비스 객체 정보 생성
            # 위험 포트가 제거된 서비스는 Safe 버전으로, 위험 포트가 없는 서비스는 원본 그대로 사용
            services_with_removed_ports = set()
            for rp in removed_risky_ports:
                if rp.get("service_name"):
                    services_with_removed_ports.add(rp["service_name"])
            
            # 먼저 개별 서비스 객체들을 생성
            for obj in original_service_objects:
                if obj["type"] == "service":
                    # 개별 서비스인 경우
                    service_name = obj["name"]
                    service_token = obj.get("token", service_name)
                    
                    # 이 서비스에서 위험 포트가 제거되었는지 확인
                    # 1. removed_risky_ports에서 service_name 또는 service_token으로 확인
                    # 2. removed_token_to_filtered에서 서비스의 원본 토큰들이 필터링되었는지 확인
                    service_has_removed = False
                    for rp in removed_risky_ports:
                        if rp.get("service_name") == service_name or rp.get("service_token") == service_token:
                            service_has_removed = True
                            break
                    
                    # service_name으로 찾지 못했어도, 서비스의 토큰이 removed_token_to_filtered에 있으면 위험 포트가 제거된 것으로 간주
                    if not service_has_removed:
                        if service_name in self.service_value_map:
                            original_tokens = self.service_value_map[service_name]
                            if any(token in removed_token_to_filtered for token in original_tokens):
                                service_has_removed = True
                        elif service_token in removed_token_to_filtered:
                            service_has_removed = True
                    
                    if service_has_removed:
                        # 위험 포트가 제거된 서비스: Safe 버전 생성
                        if service_name in self.service_value_map:
                            original_tokens = self.service_value_map[service_name]
                            service_filtered_tokens = self._create_safe_tokens_from_service_tokens(
                                original_tokens, removed_token_to_filtered
                            )
                        else:
                            # 직접 프로토콜/포트 형식인 경우
                            if service_token in removed_token_to_filtered:
                                service_filtered_tokens = removed_token_to_filtered[service_token]
                            else:
                                service_filtered_tokens = self._create_safe_tokens_from_service_tokens(
                                    {service_token}, removed_token_to_filtered
                                )
                        
                        if service_filtered_tokens:
                            safe_service_name = f"{service_name}_Safe"
                            filtered_service_objects.append({
                                "type": "service",
                                "name": safe_service_name,
                                "original_name": service_name,
                                "token": service_token,
                                "filtered_tokens": service_filtered_tokens
                            })
                    else:
                        # 위험 포트가 없는 서비스: 원본 그대로 사용
                        if service_name in self.service_value_map:
                            original_tokens = list(self.service_value_map[service_name])
                        else:
                            original_tokens = [service_token]
                        
                        filtered_service_objects.append({
                            "type": "service",
                            "name": service_name,
                            "original_name": service_name,
                            "token": service_token,
                            "filtered_tokens": original_tokens
                        })
            
            # 그룹 객체 처리 (개별 서비스 객체 생성 후)
            for obj in original_service_objects:
                if obj["type"] == "group":
                    # 서비스 그룹인 경우
                    group_name = obj["name"]
                    original_expanded_tokens = set(obj.get("expanded_tokens", []))
                    group_members = obj.get("members", [])
                    
                    # 그룹 자체에 위험 포트가 제거되었는지 확인
                    group_has_removed_ports = group_name in services_with_removed_ports
                    
                    # 그룹의 멤버 중 위험 포트를 가진 멤버가 있는지 확인
                    group_members_have_risky = any(
                        self._check_service_has_risky_port(member_name) 
                        for member_name in group_members
                    )
                    
                    # 그룹 자체에 위험 포트가 제거되었거나, 멤버 중 위험 포트를 가진 멤버가 있으면 Safe 버전 생성
                    if group_has_removed_ports or group_members_have_risky:
                        # 위험 포트가 제거된 그룹: Safe 버전 생성
                        group_filtered_tokens = []
                        for original_token in original_expanded_tokens:
                            if original_token in removed_token_to_filtered:
                                # 이미 필터링된 토큰 사용
                                group_filtered_tokens.extend(removed_token_to_filtered[original_token])
                            else:
                                # removed_token_to_filtered에 없어도 위험 포트를 다시 검사
                                # (service_members에 없었거나 다른 이유로 누락되었을 수 있음)
                                protocol, port_start, port_end = self._parse_service_token(original_token)
                                if protocol and port_start is not None and port_end is not None:
                                    matching_risky = self._find_matching_risky_ports(protocol, port_start, port_end)
                                    if matching_risky:
                                        # 위험 포트가 포함된 범위에서 제거
                                        risky_ports_in_range = []
                                        for risky_def in matching_risky:
                                            for port in range(max(port_start, risky_def.port_start), 
                                                             min(port_end, risky_def.port_end) + 1):
                                                risky_ports_in_range.append(port)
                                        
                                        # 안전한 범위로 분리
                                        safe_ranges = self._split_port_range(protocol, port_start, port_end, risky_ports_in_range)
                                        for safe_range in safe_ranges:
                                            if safe_range["port_start"] == safe_range["port_end"]:
                                                safe_token = f"{safe_range['protocol']}/{safe_range['port_start']}"
                                            else:
                                                safe_token = f"{safe_range['protocol']}/{safe_range['port_start']}-{safe_range['port_end']}"
                                            group_filtered_tokens.append(safe_token)
                                    else:
                                        # 위험 포트가 없는 토큰은 그대로 유지
                                        group_filtered_tokens.append(original_token)
                                else:
                                    # 파싱 실패한 토큰은 그대로 유지
                                    group_filtered_tokens.append(original_token)
                        
                        # 중복 제거
                        group_filtered_tokens = list(set(group_filtered_tokens))
                        
                        if group_filtered_tokens:
                            safe_group_name = f"{group_name}_Safe"
                            
                            # Safe 그룹의 필터된 멤버 목록 생성
                            # 위험 포트가 없는 멤버는 그대로 포함
                            # 위험 포트가 있는 멤버는 위험 포트를 제거한 Safe 버전 생성
                            filtered_members = []
                            risky_members = []
                            safe_member_objects = []  # 새로 생성할 Safe 멤버 객체들
                            # 이미 생성된 Safe 객체 이름 추적 (중복 생성 방지)
                            created_safe_objects = set()
                            for obj in filtered_service_objects:
                                if obj.get("name", "").endswith("_Safe"):
                                    created_safe_objects.add(obj["name"])
                            
                            for member_name in group_members:
                                # 이 멤버가 위험 포트를 가지고 있는지 확인
                                # services_with_removed_ports는 현재 정책에서 직접 사용된 서비스만 포함하므로,
                                # 그룹 멤버의 경우 _check_service_has_risky_port를 사용하여 확인
                                member_has_risky = (
                                    member_name in services_with_removed_ports or 
                                    self._check_service_has_risky_port(member_name)
                                )
                                
                                if member_has_risky:
                                    risky_members.append(member_name)
                                    
                                    # 멤버가 정책에서 직접 사용된 개별 서비스 객체인지 확인
                                    is_original_service = any(
                                        obj.get("type") == "service" and obj.get("name") == member_name
                                        for obj in original_service_objects
                                    )
                                    
                                    # 멤버가 개별 서비스 객체인 경우
                                    if member_name in self.service_value_map:
                                        safe_member_name = f"{member_name}_Safe"
                                        
                                        # 이미 생성된 Safe 객체인지 확인 (중복 생성 방지)
                                        if safe_member_name in created_safe_objects:
                                            # 이미 생성된 Safe 객체를 그룹 멤버로 사용 (바깥에 생성됨)
                                            filtered_members.append(safe_member_name)
                                            logger.info(
                                                f"그룹 {safe_group_name}의 멤버 {member_name}: "
                                                f"이미 생성된 Safe 버전 사용 (바깥에 생성됨): {safe_member_name}"
                                            )
                                        else:
                                            # 새로 Safe 버전 생성 (그룹 멤버로만 사용, 그룹 내부에 생성)
                                            member_tokens = self.service_value_map[member_name]
                                            safe_tokens = self._create_safe_tokens_from_service_tokens(
                                                member_tokens, removed_token_to_filtered
                                            )
                                            
                                            if safe_tokens:
                                                filtered_members.append(safe_member_name)
                                                safe_member_objects.append({
                                                    "type": "service",
                                                    "name": safe_member_name,
                                                    "original_name": member_name,
                                                    "token": member_name,
                                                    "filtered_tokens": safe_tokens
                                                })
                                                created_safe_objects.add(safe_member_name)
                                                logger.info(
                                                    f"그룹 {safe_group_name}의 멤버 {member_name}: "
                                                    f"Safe 버전 생성 (그룹 내부에만 생성): {safe_member_name}"
                                                )
                                            else:
                                                logger.info(
                                                    f"그룹 {safe_group_name}의 멤버 {member_name}: "
                                                    f"위험 포트 포함, Safe 버전 생성 불가 (모든 포트가 위험 포트)"
                                                )
                                    elif member_name in self.service_group_map:
                                        # 서비스 그룹인 경우: 재귀적으로 처리하지 않고 제외
                                        logger.info(
                                            f"그룹 {safe_group_name}의 멤버 {member_name}: "
                                            f"위험 포트를 포함한 서비스 그룹으로 제외됨"
                                        )
                                    else:
                                        # 알 수 없는 멤버 타입: 제외
                                        logger.warning(
                                            f"그룹 {safe_group_name}의 멤버 {member_name}: "
                                            f"알 수 없는 멤버 타입으로 제외됨"
                                        )
                                else:
                                    # 위험 포트가 없는 멤버는 무조건 포함
                                    # (그룹 멤버는 방화벽에 이미 존재하는 객체이므로)
                                    filtered_members.append(member_name)
                                    logger.debug(
                                        f"그룹 {safe_group_name}의 멤버 {member_name}: "
                                        f"위험 포트 없음, 포함됨"
                                    )
                            
                            # 새로 생성한 Safe 멤버 객체들을 filtered_service_objects에 추가
                            filtered_service_objects.extend(safe_member_objects)
                            
                            # 검증 로그
                            if not filtered_members:
                                logger.warning(
                                    f"그룹 {safe_group_name}의 filtered_members가 비어있습니다. "
                                    f"원본 멤버={group_members}, 위험 포트가 있는 멤버={risky_members}"
                                )
                            else:
                                logger.info(
                                    f"그룹 {safe_group_name}의 filtered_members 생성 완료: "
                                    f"원본 멤버={group_members} ({len(group_members)}개), "
                                    f"필터된 멤버={filtered_members} ({len(filtered_members)}개), "
                                    f"제외된 멤버={risky_members} ({len(risky_members)}개)"
                                )
                            
                            filtered_service_objects.append({
                                "type": "group",
                                "name": safe_group_name,
                                "original_name": group_name,
                                "filtered_tokens": group_filtered_tokens,
                                "members": group_members,
                                "filtered_members": filtered_members
                            })
                    else:
                        # 위험 포트가 없는 그룹: 원본 그대로 사용
                        filtered_service_objects.append({
                            "type": "group",
                            "name": group_name,
                            "original_name": group_name,
                            "filtered_tokens": list(original_expanded_tokens),
                            "members": group_members
                        })
            
            # 서비스 그룹 권장사항 생성 (위험 포트가 발견된 그룹에 대해)
            for obj in original_service_objects:
                if obj["type"] == "group":
                    group_name = obj["name"]
                    group_members = self._get_service_group_members(group_name)
                    
                    # 이 그룹에서 제거된 위험 포트가 있는지 확인
                    group_removed_ports = [r for r in removed_risky_ports if r.get("service_name") == group_name]
                    if group_removed_ports and group_members:
                        # 그룹 멤버 중 위험 포트가 있는 서비스와 없는 서비스 분리
                        safe_members = []
                        risky_members = []
                        for member_name in group_members:
                            if not self._check_service_has_risky_port(member_name):
                                safe_members.append(member_name)
                            else:
                                risky_members.append(member_name)
                        
                        # 필터된 서비스들을 위한 새 서비스 객체 이름 제안
                        filtered_service_names = []
                        # 이 그룹에서 나온 필터된 토큰들 찾기
                        group_filtered_tokens = [t for t in filtered_service_tokens if t in obj.get("expanded_tokens", [])]
                        if group_filtered_tokens:
                            filtered_service_names.append(f"{group_name}_filtered")
                        
                        recommendation = {
                            "original_group_name": group_name,
                            "can_use_original": len(safe_members) > 0,
                            "safe_members": safe_members,
                            "risky_members": risky_members,
                            "new_group_suggestion": {
                                "name": f"{group_name}_safe",
                                "members": safe_members + filtered_service_names if len(safe_members) > 0 else filtered_service_names
                            } if (len(safe_members) > 0 or filtered_service_names) else None
                        }
                        service_group_recommendations.append(recommendation)
            
            # 모든 정책을 결과에 추가 (위험 포트가 없는 정책도 포함)
            # 정책 내에서 위험 포트가 없는 서비스는 원본 그대로 사용하도록 filtered_service_objects에 포함됨
            results.append({
                "policy": policy,
                "removed_risky_ports": removed_risky_ports,
                "original_services": list(original_service_tokens),
                "original_service_objects": original_service_objects,  # 원본 서비스 객체 정보 추가
                "filtered_services": filtered_service_tokens,
                "filtered_service_objects": filtered_service_objects,  # 제거 후 서비스 객체 정보 추가
                "service_group_recommendations": service_group_recommendations
            })
        
        logger.info(f"{len(results)}개의 정책이 분석되었습니다.")
        return results

