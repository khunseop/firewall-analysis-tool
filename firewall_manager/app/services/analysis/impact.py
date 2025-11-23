
import logging
from typing import List, Dict, Any, Set, Tuple, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Policy, AnalysisTask, PolicyAddressMember, PolicyServiceMember
from app.schemas.analysis import AnalysisResultCreate

logger = logging.getLogger(__name__)


class ImpactAnalyzer:
    """정책 위치 이동 시 영향도 분석을 위한 클래스"""

    def __init__(self, db_session: AsyncSession, task: AnalysisTask, target_policy_ids: List[int], new_position: int, move_direction: Optional[str] = None):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.target_policy_ids = target_policy_ids if isinstance(target_policy_ids, list) else [target_policy_ids]
        self.new_position = new_position
        self.move_direction = move_direction  # 'above' 또는 'below'

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
        
        # 애플리케이션 겹침 확인
        app_overlap = self._applications_overlap(policy1.application, policy2.application)
        
        return src_overlap and dst_overlap and svc_overlap and app_overlap
    
    def _applications_overlap(self, app1: str, app2: str) -> bool:
        """두 애플리케이션이 겹치는지 확인합니다."""
        # None이거나 빈 문자열이면 any로 간주
        if not app1 or app1.lower() == 'any' or app1.strip() == '':
            return True
        if not app2 or app2.lower() == 'any' or app2.strip() == '':
            return True
        
        # 애플리케이션은 쉼표로 구분된 목록일 수 있음
        apps1 = set(a.strip().lower() for a in app1.split(',') if a.strip())
        apps2 = set(a.strip().lower() for a in app2.split(',') if a.strip())
        
        # 하나라도 겹치면 True
        return len(apps1 & apps2) > 0

    async def _analyze_single_policy(self, target_policy: Policy, original_position: int, policies: List[Policy]) -> Dict[str, Any]:
        """단일 정책에 대한 영향도 분석을 수행합니다."""
        # 새 위치가 유효한지 확인
        if self.new_position < 0:
            raise ValueError(f"새 위치 {self.new_position}가 유효하지 않습니다. (0 이상이어야 함)")
        if self.new_position > len(policies):
            # 배열 끝으로 이동하는 경우
            self.new_position = len(policies)
        
        # 원래 seq 확인
        original_seq = target_policy.seq or 0
        
        # 이동 방향 판단 (프론트엔드에서 전달받은 move_direction 사용)
        if self.move_direction:
            is_moving_down = self.move_direction == 'below'
        else:
            # 하위 호환: 배열 인덱스 기준으로 판단
            is_moving_down = original_position < self.new_position
        
        # 목적지 정책 찾기 (new_position에 있는 정책)
        destination_policy = None
        if self.new_position < len(policies):
            destination_policy = policies[self.new_position]
        
        # 새 위치의 seq 계산 (단순화)
        # 목적지 정책이 seq 70일 때:
        # - "위로" 이동: 목적지 정책 앞으로 → 목적지 정책 앞의 정책의 seq (목적지 정책이 첫 번째가 아닌 경우)
        # - "아래로" 이동: 목적지 정책 뒤로 → 목적지 정책의 seq + 1
        if destination_policy:
            dest_seq = destination_policy.seq or 0
            if is_moving_down:
                # 아래로 이동: 목적지 정책 뒤로 → dest_seq + 1
                new_seq = dest_seq + 1
            else:
                # 위로 이동: 목적지 정책 앞으로
                # 목적지 정책 앞의 정책이 있으면 그 정책의 seq 사용
                if self.new_position > 0:
                    prev_policy = policies[self.new_position - 1]
                    new_seq = prev_policy.seq if prev_policy else max(1, dest_seq - 1)
                else:
                    # 목적지 정책이 첫 번째인 경우
                    new_seq = max(1, dest_seq - 1) if dest_seq > 1 else 1
        else:
            # 목적지 정책이 없는 경우 (맨 끝으로 이동)
            if len(policies) > 0:
                last_policy = policies[-1]
                new_seq = (last_policy.seq or 0) + 1
            else:
                new_seq = 1
        
        # 영향받는 정책 범위 결정 (단순화)
        # 목적지 정책을 기준으로 영향 범위 결정
        if destination_policy:
            dest_seq = destination_policy.seq or 0
            if is_moving_down:
                # 아래로 이동: 원래 위치 다음부터 목적지 정책까지
                # 예: seq 1에서 seq 70 뒤로 이동 → seq 2부터 70까지의 정책들이 영향받음
                affected_start = original_position + 1
                affected_end = self.new_position
            else:
                # 위로 이동: 원래 위치부터 목적지 정책 이전까지
                # 예: seq 1에서 seq 70 앞으로 이동 → seq 1부터 69까지의 정책들이 영향받음
                affected_start = original_position
                # 목적지 정책 이전까지이므로, 목적지 정책의 인덱스 - 1
                affected_end = self.new_position - 1 if self.new_position > 0 else 0
        else:
            # 목적지 정책이 없는 경우 (맨 끝으로 이동)
            affected_start = original_position + 1
            affected_end = len(policies) - 1
        
        # seq 번호 기준 범위 계산 (표시용)
        if destination_policy:
            dest_seq = destination_policy.seq or 0
            if is_moving_down:
                # 아래로 이동: seq (original_seq + 1) ~ dest_seq
                affected_seq_start = original_seq + 1
                affected_seq_end = dest_seq
            else:
                # 위로 이동: seq original_seq ~ (dest_seq - 1)
                affected_seq_start = original_seq
                affected_seq_end = max(1, dest_seq - 1) if dest_seq > 1 else 1
        else:
            affected_seq_start = original_seq + 1
            if len(policies) > 0:
                last_policy = policies[-1]
                affected_seq_end = last_policy.seq or original_seq
            else:
                affected_seq_end = original_seq
        
        # 영향받는 정책들 확인
        blocking_policies = []  # 이동한 정책이 걸리는 차단 정책들
        shadowed_policies = []  # 이동한 정책에 의해 shadow되는 정책들
        
        # 영향받는 범위의 정책들을 순회 (배열 인덱스 기준 우선)
        for i, policy in enumerate(policies):
            # 이동하는 정책 자신은 제외
            if policy.id == target_policy.id:
                continue
            
            # 배열 인덱스 기준으로 영향 범위 확인
            if i < affected_start or i > affected_end:
                continue
            
            policy_seq = policy.seq or 0
            
            # 정책이 겹치는지 확인 (애플리케이션 포함)
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
                # 새 위치(new_seq)가 영향받는 정책의 seq보다 작으면 shadow됨
                if new_seq is not None and new_seq < policy_seq:
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
                        "move_direction": "아래로" if is_moving_down else "위로"
                    })
        
        # 최종 이동방향 결정 (프론트엔드에서 전달받은 move_direction이 있으면 그대로 사용)
        final_move_direction = "아래로" if is_moving_down else "위로"
        logger.info(f"최종 이동방향: {final_move_direction} (is_moving_down={is_moving_down}, move_direction={self.move_direction})")
        
        return {
            "target_policy_id": target_policy.id,
            "target_policy": target_policy,
            "original_position": original_position,
            "original_seq": original_seq,
            "new_position": self.new_position,
            "new_seq": new_seq,
            "move_direction": final_move_direction,
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

