
import ipaddress
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

    def __init__(self, db_session: AsyncSession, task: AnalysisTask, target_policy_ids: List[int], reference_policy_id: Optional[int] = None, move_direction: Optional[str] = None):
        """
        ImpactAnalyzer 초기화

        :param db_session: 데이터베이스 비동기 세션
        :param task: 분석 작업 객체
        :param target_policy_ids: 이동 대상 정책 ID 리스트
        :param reference_policy_id: 이동 기준이 되는 정책 ID (None이면 맨 아래로 이동)
        :param move_direction: 이동 방향 ('above' 또는 'below'). 기준 정책의 위/아래 중 어디로 이동할지 지정
        """
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.target_policy_ids = target_policy_ids if isinstance(target_policy_ids, list) else [target_policy_ids]
        self.reference_policy_id = reference_policy_id
        self.new_position: int = 0  # analyze()에서 정책 로드 후 계산됨
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

    def _get_policy_members(self, policy: Policy) -> Tuple[List, List, List]:
        """
        정책의 출발지/목적지/서비스 멤버 레코드를 방향별로 분류하여 반환합니다 (원본 멤버 객체 유지).
        """
        src_members = [m for m in policy.address_members if m.direction == 'source' and m.ip_start is not None and m.ip_end is not None]
        dst_members = [m for m in policy.address_members if m.direction == 'destination' and m.ip_start is not None and m.ip_end is not None]
        svc_members = [m for m in policy.service_members if m.protocol and m.port_start is not None and m.port_end is not None]
        return src_members, dst_members, svc_members

    def _ranges_overlap_any(self, ranges1: List[Tuple[int, int]], ranges2: List[Tuple[int, int]]) -> bool:
        """멤버 리스트 중 하나라도 서로 겹치면 True (비어있으면 'any'로 간주)."""
        if not ranges1 or not ranges2:
            return True
        return any(self._ranges_overlap(r1, r2) for r1 in ranges1 for r2 in ranges2)

    def _services_overlap_any(self, svc1: List[Tuple[str, int, int]], svc2: List[Tuple[str, int, int]]) -> bool:
        """서비스 멤버 리스트 중 하나라도 서로 겹치면 True (비어있으면 'any'로 간주)."""
        if not svc1 or not svc2:
            return True
        return any(self._services_overlap(s1, s2) for s1 in svc1 for s2 in svc2)

    def _member_ranges_overlap(
        self,
        src1: List[Tuple[int, int]], dst1: List[Tuple[int, int]], svc1: List[Tuple[str, int, int]], app1: str,
        policy2: Policy,
    ) -> bool:
        """주어진 (가상의) 출발지/목적지/서비스/애플리케이션 조건이 policy2와 겹치는지 확인합니다."""
        src2_m, dst2_m, svc2_m = self._get_policy_members(policy2)
        src2 = [(m.ip_start, m.ip_end) for m in src2_m]
        dst2 = [(m.ip_start, m.ip_end) for m in dst2_m]
        svc2 = [(m.protocol.lower(), m.port_start, m.port_end) for m in svc2_m]
        return (
            self._ranges_overlap_any(src1, src2)
            and self._ranges_overlap_any(dst1, dst2)
            and self._services_overlap_any(svc1, svc2)
            and self._applications_overlap(app1, policy2.application)
        )

    def _overlap_details(self, policy1: Policy, policy2: Policy) -> Dict[str, List[Tuple[Any, Any]]]:
        """
        두 정책 간 실제로 교집합이 발생한 (policy1 멤버, policy2 멤버) 쌍을 카테고리별로 반환합니다.
        차단/Shadow 사유에 구체적인 겹치는 값을 표시하거나, 정책 분리 제안을 계산하는 데 사용됩니다.
        """
        src1_m, dst1_m, svc1_m = self._get_policy_members(policy1)
        src2_m, dst2_m, svc2_m = self._get_policy_members(policy2)

        details: Dict[str, List[Tuple[Any, Any]]] = {"src": [], "dst": [], "svc": []}

        for m1 in src1_m:
            for m2 in src2_m:
                if self._ranges_overlap((m1.ip_start, m1.ip_end), (m2.ip_start, m2.ip_end)):
                    details["src"].append((m1, m2))

        for m1 in dst1_m:
            for m2 in dst2_m:
                if self._ranges_overlap((m1.ip_start, m1.ip_end), (m2.ip_start, m2.ip_end)):
                    details["dst"].append((m1, m2))

        for m1 in svc1_m:
            for m2 in svc2_m:
                if self._services_overlap((m1.protocol.lower(), m1.port_start, m1.port_end), (m2.protocol.lower(), m2.port_start, m2.port_end)):
                    details["svc"].append((m1, m2))

        return details

    @staticmethod
    def _format_ip_range(start: int, end: int) -> str:
        """IP 정수 범위를 사람이 읽을 수 있는 문자열로 변환합니다 (예: '192.168.1.0~192.168.1.255')."""
        try:
            start_ip = str(ipaddress.IPv4Address(start))
            end_ip = str(ipaddress.IPv4Address(end))
        except (ValueError, ipaddress.AddressValueError):
            return f"{start}-{end}"
        return start_ip if start == end else f"{start_ip}~{end_ip}"

    @staticmethod
    def _format_service(member: "PolicyServiceMember") -> str:
        """서비스 멤버를 사람이 읽을 수 있는 문자열로 변환합니다 (원본 token 우선 사용)."""
        if getattr(member, "token", None):
            return member.token
        if member.protocol and member.protocol.lower() == "any":
            return "any"
        if member.port_start == member.port_end:
            return f"{member.protocol}/{member.port_start}"
        return f"{member.protocol}/{member.port_start}-{member.port_end}"

    def _describe_overlap(self, details: Dict[str, List[Tuple[Any, Any]]]) -> str:
        """
        겹치는 구체적인 값을 사람이 읽을 수 있는 문장으로 요약합니다.
        카테고리별로 대표 겹침 값 1건과 추가 건수를 표시합니다.
        """
        parts = []
        if details["src"]:
            m1, m2 = details["src"][0]
            overlap_str = self._format_ip_range(max(m1.ip_start, m2.ip_start), min(m1.ip_end, m2.ip_end))
            extra = f" 외 {len(details['src']) - 1}건" if len(details["src"]) > 1 else ""
            parts.append(f"출발지 {overlap_str}{extra}")
        if details["dst"]:
            m1, m2 = details["dst"][0]
            overlap_str = self._format_ip_range(max(m1.ip_start, m2.ip_start), min(m1.ip_end, m2.ip_end))
            extra = f" 외 {len(details['dst']) - 1}건" if len(details["dst"]) > 1 else ""
            parts.append(f"목적지 {overlap_str}{extra}")
        if details["svc"]:
            m1, m2 = details["svc"][0]
            extra = f" 외 {len(details['svc']) - 1}건" if len(details["svc"]) > 1 else ""
            parts.append(f"서비스 {self._format_service(m2)}{extra}")
        if not parts:
            return "겹치는 조건: 전체 범위(any) 포함"
        return "겹치는 조건 — " + ", ".join(parts)

    def _find_next_conflict_index(
        self,
        target_action: str, src: List[Tuple[int, int]], dst: List[Tuple[int, int]], svc: List[Tuple[str, int, int]], application: str,
        scan_start: int, scan_end: int, is_moving_down: bool, new_seq: Optional[int], policies: List[Policy],
    ) -> Optional[int]:
        """
        주어진 (가상의) 정책 조건으로 scan_start~scan_end 범위를 이동 방향 순서대로 스캔하여
        가장 먼저 만나는 충돌 정책의 인덱스를 반환합니다 (없으면 None).
        """
        if scan_start > scan_end:
            return None
        indices = range(scan_start, scan_end + 1) if is_moving_down else range(scan_end, scan_start - 1, -1)
        for i in indices:
            policy = policies[i]
            if not self._member_ranges_overlap(src, dst, svc, application, policy):
                continue
            if target_action == 'allow' and policy.action == 'deny':
                return i
            if target_action == 'deny' and policy.action == 'allow':
                return i
            if target_action == 'allow' and policy.action == 'allow':
                policy_seq = policy.seq or 0
                if new_seq is not None and new_seq < policy_seq:
                    return i
        return None

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
        nearest_conflict_index = None  # 이동 경로상 원래 위치에서 가장 가까운 충돌 정책의 인덱스

        def _track_nearest(idx: int) -> None:
            nonlocal nearest_conflict_index
            if nearest_conflict_index is None:
                nearest_conflict_index = idx
            elif is_moving_down:
                nearest_conflict_index = min(nearest_conflict_index, idx)
            else:
                nearest_conflict_index = max(nearest_conflict_index, idx)

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

            # 겹치는 구체적인 값(출발지/목적지/서비스) 계산 — 사유 문구에 포함
            overlap_desc = self._describe_overlap(self._overlap_details(target_policy, policy))

            # [CASE 1] 이동한 정책이 상위 차단 정책에 걸리는지 확인
            # 허용(Allow) 정책을 아래로 옮겼는데, 그 위에 거부(Deny) 정책이 있는 경우
            if target_policy.action == 'allow' and policy.action == 'deny':
                _track_nearest(i)
                blocking_policies.append({
                    "policy_id": policy.id,
                    "policy": policy,
                    "current_position": policy_seq,
                    "impact_type": "차단 정책에 걸림",
                    "reason": f"이동한 허용 정책 '{target_policy.rule_name}'이 기존 거부 정책 '{policy.rule_name}'(seq {policy_seq}) 뒤로 밀려나면서 차단됩니다. ({overlap_desc})",
                    "target_policy_id": target_policy.id,
                    "target_policy_name": target_policy.rule_name,
                    "target_original_seq": original_seq,
                    "target_new_seq": new_seq,
                    "move_direction": "아래로" if is_moving_down else "위로"
                })

            # [CASE 2] 이동한 정책이 다른 정책을 무력화(Shadow)시키는지 확인
            # 거부(Deny) 정책을 위로 옮겼을 때, 아래에 있는 기존 허용(Allow) 정책을 가리는 경우
            if target_policy.action == 'deny' and policy.action == 'allow':
                _track_nearest(i)
                shadowed_policies.append({
                    "policy_id": policy.id,
                    "policy": policy,
                    "current_position": policy_seq,
                    "impact_type": "Shadow됨",
                    "reason": f"이동한 거부 정책 '{target_policy.rule_name}'이 기존 허용 정책 '{policy.rule_name}'(seq {policy_seq})보다 우선순위가 높아지면서 트래픽이 차단됩니다. ({overlap_desc})",
                    "target_policy_id": target_policy.id,
                    "target_policy_name": target_policy.rule_name,
                    "target_original_seq": original_seq,
                    "target_new_seq": new_seq,
                    "move_direction": "아래로" if is_moving_down else "위로"
                })
            # 같은 허용 정책이라도 위로 올라가면 아래 정책은 Shadow 처리됨
            elif target_policy.action == 'allow' and policy.action == 'allow':
                if new_seq is not None and new_seq < policy_seq:
                    _track_nearest(i)
                    shadowed_policies.append({
                        "policy_id": policy.id,
                        "policy": policy,
                        "current_position": policy_seq,
                        "impact_type": "Shadow됨",
                        "reason": f"이동한 허용 정책 '{target_policy.rule_name}'이 기존 허용 정책 '{policy.rule_name}'(seq {policy_seq})보다 먼저 평가됩니다. ({overlap_desc})",
                        "target_policy_id": target_policy.id,
                        "target_policy_name": target_policy.rule_name,
                        "target_original_seq": original_seq,
                        "target_new_seq": new_seq,
                        "move_direction": "아래로" if is_moving_down else "위로"
                    })
        
        final_move_direction = "아래로" if is_moving_down else "위로"

        # 이동 경로상 가장 가까운 충돌 정책 바로 앞까지를 '최대 안전 이동 위치'로 계산.
        # 충돌이 없으면 요청한 위치(new_seq)까지 그대로 이동 가능.
        nearest_conflict_policy = None
        if nearest_conflict_index is None:
            max_safe_seq = new_seq
        else:
            nearest_conflict_policy = policies[nearest_conflict_index]
            if is_moving_down:
                safe_index = nearest_conflict_index - 1
                max_safe_seq = policies[safe_index].seq if safe_index > original_position else original_seq
            else:
                safe_index = nearest_conflict_index + 1
                max_safe_seq = policies[safe_index].seq if safe_index < original_position else original_seq

        if nearest_conflict_policy is None:
            move_summary = f"'{target_policy.rule_name}'을(를) seq {new_seq}까지 안전하게 이동할 수 있습니다 (충돌 없음)."
        elif max_safe_seq == original_seq:
            move_summary = (
                f"'{target_policy.rule_name}'은(는) 바로 {'아래' if is_moving_down else '위'} 정책 "
                f"'{nearest_conflict_policy.rule_name}'(seq {nearest_conflict_policy.seq})에 가로막혀 이동할 수 없습니다."
            )
        else:
            move_summary = (
                f"'{target_policy.rule_name}'을(를) seq {max_safe_seq}까지 이동 가능합니다 "
                f"(요청한 seq {new_seq}까지는 '{nearest_conflict_policy.rule_name}'(seq {nearest_conflict_policy.seq}) 정책에 가로막혀 불가)."
            )

        # 정책 분리(split) 참고 제안: 최초 차단 정책과의 충돌이 대상 정책의 여러 항목 중
        # 일부에서만 발생했다면, 그 항목만 분리했을 때 나머지 조건이 더 내려갈 수 있는지 계산.
        split_suggestion = None
        if nearest_conflict_policy is not None:
            overlap_with_conflict = self._overlap_details(target_policy, nearest_conflict_policy)
            src_members, dst_members, svc_members = self._get_policy_members(target_policy)
            category_members = {"src": src_members, "dst": dst_members, "svc": svc_members}

            splittable_category = None
            for cat in ("src", "dst", "svc"):
                members = category_members[cat]
                overlap_pairs = overlap_with_conflict[cat]
                if not overlap_pairs:
                    continue
                conflicting_ids = {m1.id for m1, _ in overlap_pairs}
                if len(members) > 1 and len(conflicting_ids) < len(members):
                    splittable_category = cat
                    break

            if splittable_category:
                conflicting_ids = {m1.id for m1, _ in overlap_with_conflict[splittable_category]}
                remaining_members = [m for m in category_members[splittable_category] if m.id not in conflicting_ids]

                reduced_src = [(m.ip_start, m.ip_end) for m in (remaining_members if splittable_category == "src" else src_members)]
                reduced_dst = [(m.ip_start, m.ip_end) for m in (remaining_members if splittable_category == "dst" else dst_members)]
                reduced_svc = [(m.protocol.lower(), m.port_start, m.port_end) for m in (remaining_members if splittable_category == "svc" else svc_members)]

                if is_moving_down:
                    scan_start, scan_end = nearest_conflict_index + 1, affected_end
                else:
                    scan_start, scan_end = affected_start, nearest_conflict_index - 1

                next_conflict_idx = self._find_next_conflict_index(
                    target_policy.action, reduced_src, reduced_dst, reduced_svc, target_policy.application,
                    scan_start, scan_end, is_moving_down, new_seq, policies,
                )

                if next_conflict_idx is None:
                    split_max_safe_seq = new_seq
                elif is_moving_down:
                    safe_idx = next_conflict_idx - 1
                    split_max_safe_seq = policies[safe_idx].seq if safe_idx > nearest_conflict_index else max_safe_seq
                else:
                    safe_idx = next_conflict_idx + 1
                    split_max_safe_seq = policies[safe_idx].seq if safe_idx < nearest_conflict_index else max_safe_seq

                if split_max_safe_seq != max_safe_seq:
                    category_label = {"src": "출발지", "dst": "목적지", "svc": "서비스"}[splittable_category]
                    m1, m2 = overlap_with_conflict[splittable_category][0]
                    rep_value = (
                        self._format_service(m2) if splittable_category == "svc"
                        else self._format_ip_range(max(m1.ip_start, m2.ip_start), min(m1.ip_end, m2.ip_end))
                    )
                    split_suggestion = (
                        f"참고: {category_label} 조건 중 겹치는 항목({rep_value})만 별도 정책으로 분리하면, "
                        f"나머지 조건은 seq {split_max_safe_seq}까지 이동 가능할 것으로 보입니다 "
                        f"(참고용 — 실제 분리는 수동 검토 필요)."
                    )

        if split_suggestion:
            move_summary = f"{move_summary} {split_suggestion}"

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
            "total_shadowed": len(shadowed_policies),
            "max_safe_seq": max_safe_seq,
            "blocking_conflict_policy_id": nearest_conflict_policy.id if nearest_conflict_policy else None,
            "blocking_conflict_policy_name": nearest_conflict_policy.rule_name if nearest_conflict_policy else None,
            "move_summary": move_summary,
            "split_suggestion": split_suggestion,
        }

    async def analyze(self) -> List[Dict[str, Any]]:
        """
        정책 이동 영향 분석을 총괄 실행합니다.
        
        여러 정책을 동시에 이동시키는 경우 각 정책별 분석 결과를 통합하여 반환합니다.
        """
        logger.info(f"Task ID {self.task.id}에 대한 정책이동 영향분석 시작. 대상: {self.target_policy_ids}")

        policies = await self._get_policies_with_members()

        # 기준 정책 ID로 새 위치(배열 인덱스)를 계산. 지정하지 않으면 맨 아래로 이동.
        if self.reference_policy_id is None:
            self.new_position = len(policies)
        else:
            reference_position = next((i for i, p in enumerate(policies) if p.id == self.reference_policy_id), None)
            if reference_position is None:
                raise ValueError(f"기준 정책 ID {self.reference_policy_id}를 찾을 수 없습니다.")
            self.new_position = reference_position

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
        
        # 개별 정책 분석 수행 및 통합 (여러 대상 정책 간 중복 제거)
        all_blocking_policies = []
        all_shadowed_policies = []
        summary_rows = []
        seen_blocking = set()
        seen_shadowed = set()

        for target_info in target_policies_info:
            target_policy = target_info["policy"]
            single_result = await self._analyze_single_policy(
                target_policy, target_info["original_position"], policies
            )

            for bp in single_result["blocking_policies"]:
                key = (bp["policy_id"], bp["current_position"], bp["target_policy_id"])
                if key not in seen_blocking:
                    seen_blocking.add(key)
                    all_blocking_policies.append(bp)

            for sp in single_result["shadowed_policies"]:
                key = (sp["policy_id"], sp["current_position"], sp["target_policy_id"])
                if key not in seen_shadowed:
                    seen_shadowed.add(key)
                    all_shadowed_policies.append(sp)

            # 정책별 '최대 안전 이동 위치' 요약 행 (충돌 유무와 무관하게 항상 1건씩 생성)
            summary_rows.append({
                "policy_id": target_policy.id,
                "policy": target_policy,
                "current_position": single_result["max_safe_seq"],
                "impact_type": "최대 안전 이동 위치",
                "reason": single_result["move_summary"],
                "target_policy_id": target_policy.id,
                "target_policy_name": target_policy.rule_name,
                "target_original_seq": single_result["original_seq"],
                "target_new_seq": single_result["new_seq"],
                "max_safe_seq": single_result["max_safe_seq"],
                "blocking_conflict_policy_id": single_result["blocking_conflict_policy_id"],
                "blocking_conflict_policy_name": single_result["blocking_conflict_policy_name"],
                "move_direction": single_result["move_direction"],
                "split_suggestion": single_result["split_suggestion"],
            })

        logger.info(f"분석 완료: 차단 {len(all_blocking_policies)}개, Shadow {len(all_shadowed_policies)}개 발견.")

        # 프론트엔드 그리드는 평탄한 행 배열을 기대함 (다른 분석 엔진과 동일한 반환 형태)
        # 요약 행을 맨 앞에 두어 각 대상 정책의 '최대 안전 이동 위치'가 가장 먼저 보이도록 함
        return summary_rows + all_blocking_policies + all_shadowed_policies


