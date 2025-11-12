import logging
from typing import List, Dict, Any, Set, Tuple, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import crud
from app.models import Policy, AnalysisTask

logger = logging.getLogger(__name__)


class OverPermissiveAnalyzer:
    """과허용정책 분석을 위한 클래스"""
    
    def __init__(self, db_session: AsyncSession, task: AnalysisTask, target_policy_ids: Optional[List[int]] = None):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.target_policy_ids = target_policy_ids  # 분석할 정책 ID 목록 (None이면 모든 정책)
    
    def _merge_ip_ranges(self, ranges: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
        """
        IP 범위 리스트를 병합하여 중복 제거
        policy_indexer.py의 merge_ip_ranges 로직 참고
        """
        if not ranges:
            return []
        
        # 범위를 시작 IP 기준으로 정렬
        sorted_ranges = sorted(ranges)
        merged = []
        current_start, current_end = sorted_ranges[0]
        
        for i in range(1, len(sorted_ranges)):
            next_start, next_end = sorted_ranges[i]
            # 다음 범위가 현재 범위와 겹치거나 연속된 경우
            if next_start <= current_end + 1:
                current_end = max(current_end, next_end)
            else:
                # 현재 범위 완료, 리스트에 추가
                merged.append((current_start, current_end))
                current_start, current_end = next_start, next_end
        
        # 마지막 범위 추가
        merged.append((current_start, current_end))
        
        return merged
    
    def _calculate_ip_range_size(self, ranges: List[Tuple[int, int]]) -> int:
        """
        IP 범위 리스트의 총 크기 계산
        각 범위의 크기는 (end_ip - start_ip + 1)
        """
        if not ranges:
            return 0
        
        merged_ranges = self._merge_ip_ranges(ranges)
        total_size = 0
        for start_ip, end_ip in merged_ranges:
            total_size += (end_ip - start_ip + 1)
        
        return total_size
    
    def _merge_port_ranges(self, ranges: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
        """
        포트 범위 리스트를 병합하여 중복 제거
        risky_ports.py의 _calculate_port_range_size 로직 참고
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
        서비스 멤버들의 포트 범위 크기 계산
        프로토콜별로 범위를 병합하여 중복 제거 후 합산
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
        """과허용정책 분석을 실행하고 결과를 반환합니다."""
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

