
import logging
from typing import List, Dict, Any, Set, Tuple, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Policy, AnalysisTask, PolicyAddressMember, PolicyServiceMember
from app.schemas.analysis import AnalysisResultCreate

logger = logging.getLogger(__name__)


class ImpactAnalyzer:
    """
    정책 위치 이동 시 영향도를 분석하는 클래스입니다.
    
    특정 정책의 순서(Sequence)를 변경할 때, 해당 이동으로 인해 기존의 트래픽 흐름(허용/차단)이 
    어떻게 변화하는지 분석합니다. 이동 경로상에 있는 다른 정책들과의 중첩(Overlap) 여부를 
    확인하여 차단 정책에 의한 영향(Blocking)이나 기존 정책을 가리는 현상(Shadowing)을 탐지합니다.
    """

    def __init__(self, db_session: AsyncSession, task: AnalysisTask, target_policy_ids: List[int], new_position: int, move_direction: Optional[str] = None):
        """
        ImpactAnalyzer 초기화

        :param db_session: 데이터베이스 비동기 세션
        :param task: 분석 작업 객체
        :param target_policy_ids: 이동 대상 정책 ID 리스트
        :param new_position: 새 위치 (배열 인덱스 기준)
        :param move_direction: 이동 방향 ('above' 또는 'below')
        """
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.target_policy_ids = target_policy_ids if isinstance(target_policy_ids, list) else [target_policy_ids]
        self.new_position = new_position
        self.move_direction = move_direction  # 'above' 또는 'below'

    async def _get_policies_with_members(self) -> List[Policy]:
        """
        분석에 필요한 정책 및 관련 멤버(주소, 서비스) 데이터를 조회합니다.
        
        활성화된(enable=True) 정책들을 순서(seq)대로 정렬하여 가져오며,
        효율적인 분석을 위해 연관된 address_members와 service_members를 즉시 로딩(selectinload)합니다.
        """
        logger.info("정책이동 영향분석 대상 정책 데이터 조회 시작...")
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
        """
        정책에서 IP 및 서비스(포트) 범위를 추출합니다.
        
        - 출발지(source) IP 범위 리스트
        - 목적지(destination) IP 범위 리스트
        - 서비스(프로토콜, 시작 포트, 종료 포트) 리스트
        """
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
        """
        두 수치 범위(IP 또는 Port)가 서로 겹치는지 확인합니다.
        """
        return not (range1[1] < range2[0] or range2[1] < range1[0])

    def _services_overlap(self, svc1: Tuple[str, int, int], svc2: Tuple[str, int, int]) -> bool:
        """
        두 서비스 항목이 서로 겹치는지 확인합니다.
        프로토콜이 동일하거나 어느 한쪽이 'any'이면서 포트 범위가 겹칠 경우 True를 반환합니다.
        """
        # 프로토콜이 다르면 겹치지 않음
        if svc1[0] != svc2[0] and svc1[0] != 'any' and svc2[0] != 'any':
            return False
        # 포트 범위가 겹치는지 확인
        return self._ranges_overlap((svc1[1], svc1[2]), (svc2[1], svc2[2]))

    def _policies_overlap(self, policy1: Policy, policy2: Policy) -> bool:
        """
        두 정책의 조건(출발지, 목적지, 서비스, 애플리케이션)이 모두 중첩되는지 확인합니다.
        모든 조건이 겹칠 때에만 두 정책 간에 영향(Shadowing 등)이 발생할 수 있습니다.
        """
        src1, dst1, svc1 = self._get_policy_ranges(policy1)
        src2, dst2, svc2 = self._get_policy_ranges(policy2)
        
        # 출발지 중첩 확인
        src_overlap = len(src1) > 0 and len(src2) > 0 and any(
            self._ranges_overlap(r1, r2) for r1 in src1 for r2 in src2
        )
        # 목적지 중첩 확인
        dst_overlap = len(dst1) > 0 and len(dst2) > 0 and any(
            self._ranges_overlap(r1, r2) for r1 in dst1 for r2 in dst2
        )
        # 서비스 중첩 확인
        svc_overlap = len(svc1) > 0 and len(svc2) > 0 and any(
            self._services_overlap(s1, s2) for s1 in svc1 for s2 in svc2
        )
        
        # 'any' 처리: 범위 정보가 없으면 전체 범위를 포함하는 'any'로 간주
        if not src1 or not src2:
            src_overlap = True
        if not dst1 or not dst2:
            dst_overlap = True
        if not svc1 or not svc2:
            svc_overlap = True
        
        # 애플리케이션 중첩 확인
        app_overlap = self._applications_overlap(policy1.application, policy2.application)
        
        return src_overlap and dst_overlap and svc_overlap and app_overlap
    
    def _applications_overlap(self, app1: str, app2: str) -> bool:
        """
        두 애플리케이션 목록이 서로 겹치는지 확인합니다.
        """
        # None이거나 빈 문자열이면 'any'로 간주
        if not app1 or app1.lower() == 'any' or app1.strip() == '':
            return True
        if not app2 or app2.lower() == 'any' or app2.strip() == '':
            return True
        
        # 애플리케이션은 쉼표(,)로 구분된 목록일 수 있음
        apps1 = set(a.strip().lower() for a in app1.split(',') if a.strip())
        apps2 = set(a.strip().lower() for a in app2.split(',') if a.strip())
        
        # 하나라도 겹치면 중첩으로 판단
        return len(apps1 & apps2) > 0

    async def _analyze_single_policy(self, target_policy: Policy, original_position: int, policies: List[Policy]) -> Dict[str, Any]:
        """
        단일 정책의 이동 경로에 따른 영향을 상세 분석합니다.

        1. 이동 방향(위/아래)을 판단합니다.
        2. 이동 전 위치와 이동 후 위치 사이의 '영향 범위'에 속한 정책들을 추출합니다.
        3. 각 정책에 대해:
           - 차단 정책에 의한 영향(Blocking): 허용 정책을 아래로 옮겼을 때 중간에 있는 거부(Deny) 정책에 막히게 되는 경우
           - 기존 정책 가림(Shadowing): 거부 정책을 위로 옮겼을 때 아래에 있던 기존 허용 정책의 효과가 없어지는 경우 등
        """
        # 새 위치 유효성 검사
        if self.new_position < 0:
            raise ValueError(f"새 위치 {self.new_position}가 유효하지 않습니다. (0 이상이어야 함)")
        if self.new_position > len(policies):
            # 배열 범위를 벗어나면 맨 끝으로 조정
            self.new_position = len(policies)
        
        # 원래 Sequence 정보
        original_seq = target_policy.seq or 0
        
        # 이동 방향 판단
        if self.move_direction:
            is_moving_down = self.move_direction == 'below'
        else:
            is_moving_down = original_position < self.new_position
        
        # 목적지 지점의 정책 식별
        destination_policy = None
        if self.new_position < len(policies):
            destination_policy = policies[self.new_position]
        
        # 새 Sequence 번호 계산 (표시용 가상 번호)
        if destination_policy:
            dest_seq = destination_policy.seq or 0
            if is_moving_down:
                new_seq = dest_seq
            else:
                if self.new_position > 0:
                    prev_policy = policies[self.new_position - 1]
                    new_seq = prev_policy.seq if prev_policy else max(1, dest_seq - 1)
                else:
                    new_seq = max(1, dest_seq - 1) if dest_seq > 1 else 1
        else:
            if len(policies) > 0:
                last_policy = policies[-1]
                new_seq = (last_policy.seq or 0) + 1
            else:
                new_seq = 1
        
        # 분석 영향 범위 결정 (인덱스 기준)
        if destination_policy:
            if is_moving_down:
                # 아래로 이동: 현재 위치 다음부터 목적지 위치까지가 영향권
                affected_start = original_position + 1
                affected_end = self.new_position
            else:
                # 위로 이동: 목적지 위치부터 현재 위치 이전까지가 영향권
                affected_start = self.new_position
                affected_end = original_position - 1
        else:
            affected_start = original_position + 1
            affected_end = len(policies) - 1
        
        # 영향받는 정책 탐색 (차단/가림 현상 분석)
        blocking_policies = []  # 상위 차단 정책에 의해 흐름이 끊기는 경우
        shadowed_policies = []  # 이 정책이 위로 올라가면서 다른 정책을 무력화시키는 경우
        
        for i, policy in enumerate(policies):
            if policy.id == target_policy.id:
                continue
            
            # 영향 범위 내의 정책만 분석
            if i < affected_start or i > affected_end:
                continue
            
            policy_seq = policy.seq or 0
            
            # 정책 중첩(Overlap)이 없는 경우 영향 없음
            if not self._policies_overlap(target_policy, policy):
                continue
            
            # [CASE 1] 이동한 정책이 상위 차단 정책에 걸리는지 확인
            # 허용(Allow) 정책을 아래로 옮겼는데, 그 위에 거부(Deny) 정책이 있는 경우
            if target_policy.action == 'allow' and policy.action == 'deny':
                blocking_policies.append({
                    "policy_id": policy.id,
                    "policy": policy,
                    "current_position": policy_seq,
                    "impact_type": "차단 정책에 걸림",
                    "reason": f"이동한 허용 정책 '{target_policy.rule_name}'이 기존 거부 정책 '{policy.rule_name}'(seq {policy_seq}) 뒤로 밀려나면서 차단됩니다.",
                    "target_policy_id": target_policy.id,
                    "target_policy_name": target_policy.rule_name,
                    "target_original_seq": original_seq,
                    "target_new_seq": new_seq,
                    "move_direction": "아래로" if is_moving_down else "위로"
                })
            
            # [CASE 2] 이동한 정책이 다른 정책을 무력화(Shadow)시키는지 확인
            # 거부(Deny) 정책을 위로 옮겼을 때, 아래에 있는 기존 허용(Allow) 정책을 가리는 경우
            if target_policy.action == 'deny' and policy.action == 'allow':
                shadowed_policies.append({
                    "policy_id": policy.id,
                    "policy": policy,
                    "current_position": policy_seq,
                    "impact_type": "Shadow됨",
                    "reason": f"이동한 거부 정책 '{target_policy.rule_name}'이 기존 허용 정책 '{policy.rule_name}'(seq {policy_seq})보다 우선순위가 높아지면서 트래픽이 차단됩니다.",
                    "target_policy_id": target_policy.id,
                    "target_policy_name": target_policy.rule_name,
                    "target_original_seq": original_seq,
                    "target_new_seq": new_seq,
                    "move_direction": "아래로" if is_moving_down else "위로"
                })
            # 같은 허용 정책이라도 위로 올라가면 아래 정책은 Shadow 처리됨
            elif target_policy.action == 'allow' and policy.action == 'allow':
                if new_seq is not None and new_seq < policy_seq:
                    shadowed_policies.append({
                        "policy_id": policy.id,
                        "policy": policy,
                        "current_position": policy_seq,
                        "impact_type": "Shadow됨",
                        "reason": f"이동한 허용 정책 '{target_policy.rule_name}'이 기존 허용 정책 '{policy.rule_name}'(seq {policy_seq})보다 먼저 평가됩니다.",
                        "target_policy_id": target_policy.id,
                        "target_policy_name": target_policy.rule_name,
                        "target_original_seq": original_seq,
                        "target_new_seq": new_seq,
                        "move_direction": "아래로" if is_moving_down else "위로"
                    })
        
        final_move_direction = "아래로" if is_moving_down else "위로"
        
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
        """
        정책 이동 영향 분석을 총괄 실행합니다.
        
        여러 정책을 동시에 이동시키는 경우 각 정책별 분석 결과를 통합하여 반환합니다.
        """
        logger.info(f"Task ID {self.task.id}에 대한 정책이동 영향분석 시작. 대상: {self.target_policy_ids}")

        policies = await self._get_policies_with_members()
        
        # 대상 정책 정보 로드
        target_policies_info = []
        for policy_id in self.target_policy_ids:
            target_policy = None
            original_position = None
            for i, p in enumerate(policies):
                if p.id == policy_id:
                    target_policy = p
                    original_position = i
                    break
            
            if not target_policy:
                raise ValueError(f"정책 ID {policy_id}를 찾을 수 없습니다.")
            
            target_policies_info.append({
                "policy": target_policy,
                "original_position": original_position
            })
        
        # 개별 정책 분석 수행 및 통합
        all_blocking_policies = []
        all_shadowed_policies = []
        policy_results = []
        
        for target_info in target_policies_info:
            single_result = await self._analyze_single_policy(
                target_info["policy"], target_info["original_position"], policies
            )
            policy_results.append(single_result)
            
            # 결과 중복 제거 및 병합
            seen_blocking = set()
            for bp in single_result["blocking_policies"]:
                key = (bp["policy_id"], bp["current_position"], bp["target_policy_id"])
                if key not in seen_blocking:
                    seen_blocking.add(key)
                    all_blocking_policies.append(bp)
            
            seen_shadowed = set()
            for sp in single_result["shadowed_policies"]:
                key = (sp["policy_id"], sp["current_position"], sp["target_policy_id"])
                if key not in seen_shadowed:
                    seen_shadowed.add(key)
                    all_shadowed_policies.append(sp)
        
        result = {
            "target_policy_ids": self.target_policy_ids,
            "target_policies": [info["policy"] for info in target_policies_info],
            "new_position": self.new_position,
            "blocking_policies": all_blocking_policies,
            "shadowed_policies": all_shadowed_policies,
            "total_blocking": len(all_blocking_policies),
            "total_shadowed": len(all_shadowed_policies),
            "policy_results": policy_results
        }
        
        logger.info(f"분석 완료: 차단 {len(all_blocking_policies)}개, Shadow {len(all_shadowed_policies)}개 발견.")
        return result


