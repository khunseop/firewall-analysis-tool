
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

    def __init__(self, db_session: AsyncSession, task: AnalysisTask, target_policy_ids: List[int], new_position: int):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.target_policy_ids = target_policy_ids if isinstance(target_policy_ids, list) else [target_policy_ids]
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

    async def _analyze_single_policy(self, target_policy: Policy, original_position: int, policies: List[Policy]) -> Dict[str, Any]:
        """단일 정책에 대한 영향도 분석을 수행합니다."""
        # 새 위치가 유효한지 확인
        if self.new_position < 0 or self.new_position >= len(policies):
            raise ValueError(f"새 위치 {self.new_position}가 유효하지 않습니다. (0-{len(policies)-1})")
        
        # 원래 seq와 새 위치의 seq 확인
        original_seq = target_policy.seq or 0
        new_seq_policy = policies[self.new_position] if self.new_position < len(policies) else None
        new_seq = new_seq_policy.seq if new_seq_policy else None
        
        # 이동 방향 결정 (seq 번호 기준)
        is_moving_down = original_seq < new_seq if new_seq is not None else original_position < self.new_position
        
        # 영향받는 정책 범위 결정 (seq 번호 기준)
        # 아래로 이동: 원래 seq 다음부터 새 seq까지
        # 위로 이동: 새 seq부터 원래 seq 이전까지
        affected_seq_start = None
        affected_seq_end = None
        affected_start = None
        affected_end = None
        
        if new_seq is not None:
            if is_moving_down:
                # 아래로 이동: seq (original_seq + 1) ~ new_seq
                affected_seq_start = original_seq + 1
                affected_seq_end = new_seq
            else:
                # 위로 이동: seq new_seq ~ (original_seq - 1)
                affected_seq_start = new_seq
                affected_seq_end = original_seq - 1
        else:
            # new_seq가 None인 경우 배열 인덱스 기준으로 폴백
            if is_moving_down:
                affected_start = original_position + 1
                affected_end = self.new_position
            else:
                affected_start = self.new_position
                affected_end = original_position - 1
        
        # 영향받는 정책들 확인
        blocking_policies = []  # 이동한 정책이 걸리는 차단 정책들
        shadowed_policies = []  # 이동한 정책에 의해 shadow되는 정책들
        
        # 영향받는 범위의 정책들을 순회 (seq 번호 기준)
        for i, policy in enumerate(policies):
            # 이동하는 정책 자신은 제외
            if policy.id == target_policy.id:
                continue
            
            policy_seq = policy.seq or 0
            
            # seq 번호 기준으로 영향 범위 확인
            if affected_seq_start is not None and affected_seq_end is not None:
                # seq 번호 기준 범위 체크
                if policy_seq < affected_seq_start or policy_seq > affected_seq_end:
                    continue
            else:
                # 배열 인덱스 기준 범위 체크 (폴백)
                if i < affected_start or i > affected_end:
                    continue
            
            # 정책이 겹치는지 확인
            if not self._policies_overlap(target_policy, policy):
                continue
            
            # 1. 이동한 정책이 차단 정책에 걸리는지 확인
            # 이동한 정책이 allow이고, 영향받는 정책이 deny인 경우
            if target_policy.action == 'allow' and policy.action == 'deny':
                blocking_policies.append({
                    "policy_id": policy.id,
                    "policy": policy,
                    "current_position": policy_seq,  # seq 번호 사용
                    "impact_type": "차단 정책에 걸림",
                    "reason": f"이동한 정책 '{target_policy.rule_name}' (seq {original_seq}, allow)이 정책 '{policy.rule_name}' (seq {policy_seq}, deny)에 의해 차단됨",
                    "target_policy_id": target_policy.id,
                    "target_policy_name": target_policy.rule_name,
                    "target_original_seq": original_seq,
                    "target_new_seq": new_seq,
                    "move_direction": "아래로" if is_moving_down else "위로"
                })
            
            # 2. 이동한 정책이 다른 정책을 shadow하는지 확인
            # 이동한 정책이 deny이고, 영향받는 정책이 allow인 경우
            if target_policy.action == 'deny' and policy.action == 'allow':
                shadowed_policies.append({
                    "policy_id": policy.id,
                    "policy": policy,
                    "current_position": policy_seq,  # seq 번호 사용
                    "impact_type": "Shadow됨",
                    "reason": f"이동한 정책 '{target_policy.rule_name}' (seq {original_seq}→{new_seq}, deny)이 정책 '{policy.rule_name}' (seq {policy_seq}, allow)을 가림",
                    "target_policy_id": target_policy.id,
                    "target_policy_name": target_policy.rule_name,
                    "target_original_seq": original_seq,
                    "target_new_seq": new_seq,
                    "move_direction": "아래로" if is_moving_down else "위로"
                })
            elif target_policy.action == 'allow' and policy.action == 'allow':
                # 같은 액션이지만 이동한 정책이 더 위에 있으면 shadow
                # 아래로 이동하는 경우: 새 위치가 영향받는 정책보다 아래에 있으므로 shadow 안됨
                # 위로 이동하는 경우: 새 위치가 영향받는 정책보다 위에 있으므로 shadow됨
                if not is_moving_down:  # 위로 이동하는 경우만 shadow
                    shadowed_policies.append({
                        "policy_id": policy.id,
                        "policy": policy,
                        "current_position": policy_seq,  # seq 번호 사용
                        "impact_type": "Shadow됨",
                        "reason": f"이동한 정책 '{target_policy.rule_name}' (seq {original_seq}→{new_seq}, allow)이 정책 '{policy.rule_name}' (seq {policy_seq}, allow)보다 먼저 평가되어 가림",
                        "target_policy_id": target_policy.id,
                        "target_policy_name": target_policy.rule_name,
                        "target_original_seq": original_seq,
                        "target_new_seq": new_seq,
                        "move_direction": "위로"
                    })
        
        return {
            "target_policy_id": target_policy.id,
            "target_policy": target_policy,
            "original_position": original_position,
            "original_seq": original_seq,
            "new_position": self.new_position,
            "new_seq": new_seq,
            "move_direction": "아래로" if is_moving_down else "위로",
            "blocking_policies": blocking_policies,
            "shadowed_policies": shadowed_policies,
            "total_blocking": len(blocking_policies),
            "total_shadowed": len(shadowed_policies)
        }

    async def analyze(self) -> Dict[str, Any]:
        """영향도 분석을 실행하고 결과를 반환합니다.
        
        여러 정책에 대해 개별적으로 분석을 수행하고 결과를 통합합니다.
        
        분석 내용:
        1. 출발지와 목적지 사이의 차단 정책에 걸리는지 확인
        2. 출발지와 목적지 사이의 정책 중 shadow되는 정책 확인
        """
        logger.info(f"Task ID {self.task.id}에 대한 영향도 분석 시작. 정책 ID: {self.target_policy_ids}, 새 위치: {self.new_position}")

        policies = await self._get_policies_with_members()
        
        # 대상 정책들 찾기
        target_policies_info = []
        for policy_id in self.target_policy_ids:
            target_policy = None
            original_position = None
            for i, policy in enumerate(policies):
                if policy.id == policy_id:
                    target_policy = policy
                    original_position = i
                    break
            
            if not target_policy:
                raise ValueError(f"정책 ID {policy_id}를 찾을 수 없습니다.")
            
            target_policies_info.append({
                "policy": target_policy,
                "original_position": original_position
            })
        
        # 각 정책에 대해 개별 분석 수행
        all_blocking_policies = []
        all_shadowed_policies = []
        policy_results = []
        
        # 정책별 정보를 빠르게 조회하기 위한 맵 생성
        policy_info_map = {}
        for target_info in target_policies_info:
            policy_info_map[target_info["policy"].id] = {
                "policy": target_info["policy"],
                "original_position": target_info["original_position"]
            }
        
        for target_info in target_policies_info:
            target_policy = target_info["policy"]
            original_position = target_info["original_position"]
            
            single_result = await self._analyze_single_policy(target_policy, original_position, policies)
            policy_results.append(single_result)
            
            # 결과 통합 (중복 제거를 위해 policy_id와 current_position 조합으로 확인)
            seen_blocking = set()
            seen_shadowed = set()
            
            for bp in single_result["blocking_policies"]:
                key = (bp["policy_id"], bp["current_position"], bp["target_policy_id"])
                if key not in seen_blocking:
                    seen_blocking.add(key)
                    # 각 정책별 정보가 이미 포함되어 있으므로 그대로 추가
                    all_blocking_policies.append(bp)
            
            for sp in single_result["shadowed_policies"]:
                key = (sp["policy_id"], sp["current_position"], sp["target_policy_id"])
                if key not in seen_shadowed:
                    seen_shadowed.add(key)
                    # 각 정책별 정보가 이미 포함되어 있으므로 그대로 추가
                    all_shadowed_policies.append(sp)
        
        # 통합 결과 생성
        result = {
            "target_policy_ids": self.target_policy_ids,
            "target_policies": [info["policy"] for info in target_policies_info],
            "new_position": self.new_position,
            "blocking_policies": all_blocking_policies,
            "shadowed_policies": all_shadowed_policies,
            "total_blocking": len(all_blocking_policies),
            "total_shadowed": len(all_shadowed_policies),
            "policy_results": policy_results  # 개별 정책별 상세 결과
        }
        
        logger.info(f"{len(self.target_policy_ids)}개 정책 분석 완료. 차단 정책 {len(all_blocking_policies)}개, Shadow 정책 {len(all_shadowed_policies)}개 발견.")
        return result

