import logging
from typing import List, Dict, Any, Set, Tuple, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import crud
from app.models import Policy, AnalysisTask

logger = logging.getLogger(__name__)


class OverPermissiveAnalyzer:
    """
    과허용(Over-Permissive) 정책을 식별하기 위한 분석 클래스입니다.
    
    출발지/목적지 IP 범위의 크기나 서비스 포트의 범위를 계산하여, 
    'any' 또는 과도하게 넓은 서브넷(예: /8, /16 등)이 포함된 정책을 탐지합니다.
    """
    
    def __init__(self, db_session: AsyncSession, task: AnalysisTask, target_policy_ids: Optional[List[int]] = None):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.target_policy_ids = target_policy_ids  # 분석할 정책 ID 목록 (None이면 모든 정책)
    
    def _merge_ip_ranges(self, ranges: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
        """
        겹치거나 연속된 IP 범위들을 하나로 병합하여 중복 계산을 방지합니다.
        
        알고리즘:
        1. 범위를 시작 IP 기준으로 정렬합니다.
        2. 현재 범위의 끝과 다음 범위의 시작을 비교하여 겹치거나 연속되면 확장합니다.
        3. 겹치지 않는 경우 새로운 범위로 분리합니다.
        """
        if not ranges:
            return []
        
        # 범위를 시작 IP 기준으로 정렬
        sorted_ranges = sorted(ranges)
        merged = []
        current_start, current_end = sorted_ranges[0]
        
        for i in range(1, len(sorted_ranges)):
            next_start, next_end = sorted_ranges[i]
            # 다음 범위가 현재 범위와 겹치거나 연속된 경우 (IP는 연속된 숫자이므로 +1)
            if next_start <= current_end + 1:
                current_end = max(current_end, next_end)
            else:
                # 겹치지 않으면 현재까지 병합된 범위 저장
                merged.append((current_start, current_end))
                current_start, current_end = next_start, next_end
        
        # 마지막 범위 추가
        merged.append((current_start, current_end))
        
        return merged
    
    def _calculate_ip_range_size(self, ranges: List[Tuple[int, int]]) -> int:
        """
        IP 범위 리스트의 총 호스트 수를 계산합니다.
        각 범위의 크기는 (종료_IP - 시작_IP + 1)로 계산됩니다.
        """
        if not ranges:
            return 0
        
        # 범위 병합 후 크기 합산
        merged_ranges = self._merge_ip_ranges(ranges)
        total_size = 0
        for start_ip, end_ip in merged_ranges:
            total_size += (end_ip - start_ip + 1)
        
        return total_size
    
    def _merge_port_ranges(self, ranges: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
        """
        겹치거나 연속된 포트 범위들을 병합합니다.
        IP 범위 병합 로직과 동일하게 작동합니다.
        """
        if not ranges:
            return []
        
        sorted_ranges = sorted(ranges)
        merged = []
        current_start, current_end = sorted_ranges[0]
        
        for i in range(1, len(sorted_ranges)):
            next_start, next_end = sorted_ranges[i]
            if next_start <= current_end + 1:
                current_end = max(current_end, next_end)
            else:
                merged.append((current_start, current_end))
                current_start, current_end = next_start, next_end
        
        merged.append((current_start, current_end))
        return merged
    
    def _calculate_service_range_size(self, service_members: List[Any]) -> int:
        """
        서비스 멤버들의 전체 포트 수 합계를 계산합니다.
        
        알고리즘:
        1. 프로토콜별(TCP/UDP 등)로 포트 범위를 수집합니다.
        2. 'any' 프로토콜인 경우 0-65535 전체 범위를 할당합니다.
        3. 각 프로토콜 내에서 포트 범위를 병합하여 중복을 제거한 뒤 크기를 합산합니다.
        """
        if not service_members:
            return 0
        
        protocol_ranges: Dict[str, List[Tuple[int, int]]] = {}
        
        for member in service_members:
            protocol = member.protocol
            port_start = member.port_start
            port_end = member.port_end
            
            if protocol:
                protocol_lower = protocol.lower()
                if protocol_lower == 'any':
                    # any 프로토콜은 0-65535 범위로 계산
                    if protocol_lower not in protocol_ranges:
                        protocol_ranges[protocol_lower] = []
                    protocol_ranges[protocol_lower].append((0, 65535))
                elif port_start is not None and port_end is not None:
                    # 일반 프로토콜은 실제 포트 범위 사용
                    if protocol_lower not in protocol_ranges:
                        protocol_ranges[protocol_lower] = []
                    protocol_ranges[protocol_lower].append((port_start, port_end))
        
        total_size = 0
        for protocol, ranges in protocol_ranges.items():
            merged_ranges = self._merge_port_ranges(ranges)
            for start, end in merged_ranges:
                total_size += (end - start + 1)
        
        return total_size
    
    async def _get_policies_with_members(self) -> List[Policy]:
        """분석에 필요한 정책과 멤버 데이터를 DB에서 조회합니다."""
        logger.info("분석 대상 정책 데이터 조회 시작...")
        stmt = (
            select(Policy)
            .where(
                Policy.device_id == self.device_id
            )
            .options(
                selectinload(Policy.address_members),
                selectinload(Policy.service_members)
            )
            .order_by(Policy.seq)
        )
        
        # target_policy_ids가 제공되면 해당 정책들만 필터링
        if self.target_policy_ids:
            stmt = stmt.where(Policy.id.in_(self.target_policy_ids))
            logger.info(f"정책 ID 필터 적용: {self.target_policy_ids}")
        
        result = await self.db.execute(stmt)
        policies = result.scalars().all()
        logger.info(f"총 {len(policies)}개의 정책이 조회되었습니다.")
        return policies
    
    async def analyze(self) -> List[Dict[str, Any]]:
        """
        과허용 정책 분석을 실행하고 결과를 반환합니다.
        
        분석 과정:
        1. 대상 정책들의 출발지/목적지/서비스 멤버 정보를 수집합니다.
        2. 각 정책에 대해 실제 IP 범위 및 포트 범위의 합산 크기를 계산합니다.
        3. 계산된 수치(source_range_size, destination_range_size, service_range_size)를 결과 리스트에 담습니다.
        """
        logger.info(f"Task ID {self.task.id}에 대한 과허용정책 분석 시작.")
        
        # 정책 조회
        policies = await self._get_policies_with_members()
        
        results = []
        
        for policy in policies:
            # 출발지 IP 범위 수집
            source_ranges = []
            for member in policy.address_members:
                if member.direction == 'source' and member.ip_start is not None and member.ip_end is not None:
                    source_ranges.append((member.ip_start, member.ip_end))
            
            # 목적지 IP 범위 수집
            destination_ranges = []
            for member in policy.address_members:
                if member.direction == 'destination' and member.ip_start is not None and member.ip_end is not None:
                    destination_ranges.append((member.ip_start, member.ip_end))
            
            # 출발지 IP 범위 크기 계산
            source_range_size = self._calculate_ip_range_size(source_ranges)
            
            # 목적지 IP 범위 크기 계산
            destination_range_size = self._calculate_ip_range_size(destination_ranges)
            
            # 서비스 포트 범위 크기 계산
            service_range_size = self._calculate_service_range_size(policy.service_members)
            
            results.append({
                "policy": policy,
                "source_range_size": source_range_size,
                "destination_range_size": destination_range_size,
                "service_range_size": service_range_size
            })
        
        logger.info(f"{len(results)}개의 정책이 분석되었습니다.")
        return results

