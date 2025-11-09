
import logging
from typing import List, Dict, Any, Set, Tuple
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Policy, AnalysisTask, PolicyAddressMember, PolicyServiceMember
from app.schemas.analysis import AnalysisResultCreate

logger = logging.getLogger(__name__)


class ImpactAnalyzer:
    """정책 위치 이동 시 영향도 분석을 위한 클래스"""

    def __init__(self, db_session: AsyncSession, task: AnalysisTask, target_policy_id: int, new_position: int):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.target_policy_id = target_policy_id
        self.new_position = new_position

    async def _get_policies_with_members(self) -> List[Policy]:
        """분석에 필요한 정책과 멤버 데이터를 조회합니다."""
        logger.info("영향도 분석 대상 정책 데이터 조회 시작...")
        stmt = (
            select(Policy)
            .where(
                Policy.device_id == self.device_id,
                Policy.enable == True
            )
            .options(
                selectinload(Policy.address_members),
                selectinload(Policy.service_members)
            )
            .order_by(Policy.seq)
        )
        result = await self.db.execute(stmt)
        policies = result.scalars().all()
        logger.info(f"총 {len(policies)}개의 정책이 조회되었습니다.")
        return policies

    def _get_policy_ranges(self, policy: Policy) -> Tuple[Set[Tuple[int, int]], Set[Tuple[int, int]], Set[Tuple[str, int, int]]]:
        """정책의 IP 범위와 서비스 범위를 추출합니다."""
        src_ranges = set()
        dst_ranges = set()
        services = set()
        
        for member in policy.address_members:
            if member.direction == 'source' and member.ip_start is not None and member.ip_end is not None:
                src_ranges.add((member.ip_start, member.ip_end))
            elif member.direction == 'destination' and member.ip_start is not None and member.ip_end is not None:
                dst_ranges.add((member.ip_start, member.ip_end))
        
        for member in policy.service_members:
            if member.protocol and member.port_start is not None and member.port_end is not None:
                services.add((member.protocol.lower(), member.port_start, member.port_end))
        
        return src_ranges, dst_ranges, services

    def _ranges_overlap(self, range1: Tuple[int, int], range2: Tuple[int, int]) -> bool:
        """두 범위가 겹치는지 확인합니다."""
        return not (range1[1] < range2[0] or range2[1] < range1[0])

    def _services_overlap(self, svc1: Tuple[str, int, int], svc2: Tuple[str, int, int]) -> bool:
        """두 서비스가 겹치는지 확인합니다."""
        # 프로토콜이 다르면 겹치지 않음
        if svc1[0] != svc2[0] and svc1[0] != 'any' and svc2[0] != 'any':
            return False
        # 포트 범위가 겹치는지 확인
        return self._ranges_overlap((svc1[1], svc1[2]), (svc2[1], svc2[2]))

    def _policies_overlap(self, policy1: Policy, policy2: Policy) -> bool:
        """두 정책이 겹치는지 확인합니다."""
        src1, dst1, svc1 = self._get_policy_ranges(policy1)
        src2, dst2, svc2 = self._get_policy_ranges(policy2)
        
        # 출발지, 목적지, 서비스가 모두 겹쳐야 함
        src_overlap = len(src1) > 0 and len(src2) > 0 and any(
            self._ranges_overlap(r1, r2) for r1 in src1 for r2 in src2
        )
        dst_overlap = len(dst1) > 0 and len(dst2) > 0 and any(
            self._ranges_overlap(r1, r2) for r1 in dst1 for r2 in dst2
        )
        svc_overlap = len(svc1) > 0 and len(svc2) > 0 and any(
            self._services_overlap(s1, s2) for s1 in svc1 for s2 in svc2
        )
        
        # any 처리: 범위가 비어있으면 any로 간주
        if not src1 or not src2:
            src_overlap = True
        if not dst1 or not dst2:
            dst_overlap = True
        if not svc1 or not svc2:
            svc_overlap = True
        
        return src_overlap and dst_overlap and svc_overlap

    async def analyze(self) -> Dict[str, Any]:
        """영향도 분석을 실행하고 결과를 반환합니다.
        
        분석 내용:
        1. 출발지와 목적지 사이의 차단 정책에 걸리는지 확인
        2. 출발지와 목적지 사이의 정책 중 shadow되는 정책 확인
        """
        logger.info(f"Task ID {self.task.id}에 대한 영향도 분석 시작. 정책 ID: {self.target_policy_id}, 새 위치: {self.new_position}")

        policies = await self._get_policies_with_members()
        
        # 대상 정책 찾기
        target_policy = None
        original_position = None
        for i, policy in enumerate(policies):
            if policy.id == self.target_policy_id:
                target_policy = policy
                original_position = i
                break
        
        if not target_policy:
            raise ValueError(f"정책 ID {self.target_policy_id}를 찾을 수 없습니다.")
        
        # 새 위치가 유효한지 확인
        if self.new_position < 0 or self.new_position >= len(policies):
            raise ValueError(f"새 위치 {self.new_position}가 유효하지 않습니다. (0-{len(policies)-1})")
        
        # 출발지와 목적지 위치 결정 (항상 작은 값이 출발지)
        start_pos = min(original_position, self.new_position)
        end_pos = max(original_position, self.new_position)
        
        # 출발지와 목적지 사이의 정책들 확인 (경계 포함)
        blocking_policies = []  # 이동한 정책이 걸리는 차단 정책들
        shadowed_policies = []  # 이동한 정책에 의해 shadow되는 정책들
        
        # 출발지와 목적지 사이의 정책들을 순회
        for i in range(start_pos, end_pos + 1):
            if i == original_position:
                continue  # 이동하는 정책 자신은 제외
            
            policy = policies[i]
            
            # 정책이 겹치는지 확인
            if not self._policies_overlap(target_policy, policy):
                continue
            
            # 1. 이동한 정책이 차단 정책에 걸리는지 확인
            # 이동한 정책이 allow이고, 사이의 정책이 deny인 경우
            if target_policy.action == 'allow' and policy.action == 'deny':
                blocking_policies.append({
                    "policy_id": policy.id,
                    "policy": policy,
                    "current_position": i,
                    "impact_type": "차단 정책에 걸림",
                    "reason": f"이동한 정책 '{target_policy.rule_name}' (allow)이 정책 '{policy.rule_name}' (deny)에 의해 차단됨"
                })
            
            # 2. 이동한 정책이 다른 정책을 shadow하는지 확인
            # 이동한 정책이 deny이고, 사이의 정책이 allow인 경우
            # 또는 이동한 정책이 allow이고, 사이의 정책도 allow인 경우 (더 위에 있으면 shadow)
            if target_policy.action == 'deny' and policy.action == 'allow':
                shadowed_policies.append({
                    "policy_id": policy.id,
                    "policy": policy,
                    "current_position": i,
                    "impact_type": "Shadow됨",
                    "reason": f"이동한 정책 '{target_policy.rule_name}' (deny)이 정책 '{policy.rule_name}' (allow)을 가림"
                })
            elif target_policy.action == 'allow' and policy.action == 'allow':
                # 같은 액션이지만 이동한 정책이 더 위에 있으면 shadow
                if self.new_position < i:
                    shadowed_policies.append({
                        "policy_id": policy.id,
                        "policy": policy,
                        "current_position": i,
                        "impact_type": "Shadow됨",
                        "reason": f"이동한 정책 '{target_policy.rule_name}' (allow)이 정책 '{policy.rule_name}' (allow)보다 먼저 평가되어 가림"
                    })
        
        result = {
            "target_policy_id": target_policy.id,
            "target_policy": target_policy,
            "original_position": original_position,
            "new_position": self.new_position,
            "blocking_policies": blocking_policies,  # 차단 정책에 걸리는 경우
            "shadowed_policies": shadowed_policies,  # shadow되는 정책들
            "total_blocking": len(blocking_policies),
            "total_shadowed": len(shadowed_policies)
        }
        
        logger.info(f"차단 정책 {len(blocking_policies)}개, Shadow 정책 {len(shadowed_policies)}개 발견.")
        return result

