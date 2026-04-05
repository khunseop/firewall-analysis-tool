
import logging
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import crud
from app.models import Policy, Device, AnalysisTask, PolicyAddressMember, PolicyServiceMember
from app.schemas.analysis import RedundancyPolicySetCreate
from app.models.analysis import RedundancyPolicySetType

logger = logging.getLogger(__name__)

class RedundancyAnalyzer:
    """
    중복 정책 분석을 수행하는 클래스입니다.
    
    방화벽 정책 간의 소스(Source), 목적지(Destination), 서비스(Service) 포함 관계를 비교하여
    완전히 동일하거나 다른 정책에 의해 포함되는 중복/하위 집합 정책을 탐지합니다.
    """

    def __init__(self, db_session: AsyncSession, task: AnalysisTask):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.vendor = ""

    async def _get_policies_with_members(self) -> List[Policy]:
        """
        분석에 필요한 정책과 관련 멤버(주소, 서비스) 데이터를 DB에서 조회합니다.
        
        활성화된 정책 중 'allow' 액션을 가진 정책만을 대상으로 하며, 
        정책의 우선순위(seq) 순으로 정렬하여 상단 정책이 하단 정책을 포함하는지 확인합니다.
        """
        logger.info("분석 대상 정책 데이터 조회 시작...")
        stmt = (
            select(Policy)
            .where(
                Policy.device_id == self.device_id,
                Policy.enable == True,
                Policy.action == 'allow'
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

    @staticmethod
    def _normalize_text_field(value: Optional[str]) -> Tuple[str, ...]:
        """콤마 구분 텍스트 필드를 정렬된 튜플로 정규화합니다.

        'A,B' 와 'B,A' 를 동일하게 취급합니다.
        """
        if not value:
            return ()
        return tuple(sorted(v.strip() for v in value.split(',') if v.strip()))

    def _normalize_policy_key(self, policy: Policy) -> Tuple:
        """
        정책의 중복 여부를 판단하기 위한 정규화된 고유 키를 생성합니다.

        비교 기준:
        - 출발지/목적지 주소: 인덱서가 해소한 숫자형 IP 범위 (ip_start-ip_end) 집합의 정확한 일치.
          예) Host_A(192.168.1.0/24)와 Host_C(192.168.1.0/24)는 같은 범위로 매칭,
              Host_B(192.168.1.2)는 다른 범위이므로 미매칭.
        - 서비스: 프로토콜 + 포트 범위 집합의 정확한 일치.
        - 나머지 텍스트 필드(user, application 등): 콤마 기준 분리 후 정렬 비교.
        """
        # 출발지 주소: 해소된 IP 범위 집합 (빈 그룹 토큰 포함)
        src_addrs = []
        for m in policy.address_members:
            if m.direction == 'source':
                if m.ip_start is not None and m.ip_end is not None:
                    src_addrs.append(f"{m.ip_start}-{m.ip_end}")
                elif m.token and m.token_type == 'unknown':
                    src_addrs.append(f"__GROUP__:{m.token}")
        src_addrs = tuple(sorted(src_addrs))

        # 목적지 주소
        dst_addrs = []
        for m in policy.address_members:
            if m.direction == 'destination':
                if m.ip_start is not None and m.ip_end is not None:
                    dst_addrs.append(f"{m.ip_start}-{m.ip_end}")
                elif m.token and m.token_type == 'unknown':
                    dst_addrs.append(f"__GROUP__:{m.token}")
        dst_addrs = tuple(sorted(dst_addrs))

        # 서비스: 해소된 포트 범위 집합 (빈 그룹 토큰 포함)
        services = []
        for m in policy.service_members:
            if m.port_start is not None and m.port_end is not None:
                services.append(f"{m.protocol}/{m.port_start}-{m.port_end}")
            elif m.token and m.token_type == 'unknown':
                services.append(f"__GROUP__:{m.token}")
        services = tuple(sorted(services))

        # 텍스트 필드: 콤마 분리 후 정렬 비교
        key_fields = [
            policy.action,
            src_addrs,
            self._normalize_text_field(policy.user),
            dst_addrs,
            services,
            self._normalize_text_field(policy.application),
        ]

        # 벤더 특화 필드 (Palo Alto)
        if self.vendor == 'paloalto':
            key_fields.extend([
                self._normalize_text_field(policy.security_profile),
                self._normalize_text_field(policy.category),
                policy.vsys,  # vsys는 단일 값
            ])

        return tuple(key_fields)

    async def analyze(self) -> List[RedundancyPolicySetCreate]:
        """
        중복 정책 분석을 실행하고 결과를 반환합니다.
        
        분석 알고리즘:
        1. 모든 정책에 대해 정규화된 키를 생성합니다.
        2. 해시 맵(policy_map)을 사용하여 동일한 키를 가진 정책들을 그룹화(Set Number 부여)합니다.
        3. 먼저 나타난 정책(seq가 낮은 정책)을 'UPPER(상위)', 이후에 나타난 정책을 'LOWER(하위)'로 분류합니다.
        4. 동일한 셋 내에 하위 정책이 존재하는 경우에만 해당 정책 셋을 결과에 포함합니다.
        """
        logger.info(f"Task ID {self.task.id}에 대한 중복 정책 분석 시작.")

        device = await crud.device.get_device(self.db, device_id=self.device_id)
        if not device:
            raise ValueError(f"Device ID {self.device_id}를 찾을 수 없습니다.")
        self.vendor = device.vendor

        policies = await self._get_policies_with_members()

        policy_map: Dict[Tuple, int] = {}
        temp_results: List[RedundancyPolicySetCreate] = []
        upper_rules: Dict[int, RedundancyPolicySetCreate] = {}
        lower_rules_count: Dict[int, int] = defaultdict(int)
        current_set_number = 1

        logger.info("정책 중복 여부 확인 중...")
        for policy in policies:
            key = self._normalize_policy_key(policy)
            
            # 이미 동일한 키가 맵에 존재하는 경우 (중복 발견)
            if key in policy_map:
                set_number = policy_map[key]
                result = RedundancyPolicySetCreate(
                    task_id=self.task.id,
                    set_number=set_number,
                    type=RedundancyPolicySetType.LOWER,
                    policy_id=policy.id
                )
                temp_results.append(result)
                lower_rules_count[set_number] += 1
            else:
                # 새로운 정책 키 등록 (상위 정책 후보)
                policy_map[key] = current_set_number
                result = RedundancyPolicySetCreate(
                    task_id=self.task.id,
                    set_number=current_set_number,
                    type=RedundancyPolicySetType.UPPER,
                    policy_id=policy.id
                )
                upper_rules[current_set_number] = result
                current_set_number += 1

        logger.info("분석 완료. 결과 집계 중...")
        final_results = []
        # 하위 정책이 있는 상위 정책만 결과에 포함
        for set_num, upper_rule in upper_rules.items():
            if lower_rules_count[set_num] > 0:
                final_results.append(upper_rule)

        # 모든 하위 정책 추가
        final_results.extend([
            r for r in temp_results if r.type == RedundancyPolicySetType.LOWER
        ])

        if not final_results:
            logger.info("중복 정책이 발견되지 않았습니다.")
            return []

        logger.info(f"{len(final_results)}개의 중복 분석 결과를 찾았습니다.")
        return final_results

    # ------------------------------------------------------------------
    # 논리적 포함 관계 분석 (fpat RedundancyAnalyzer.analyze_logical() 이식)
    # DB에 저장된 정수형 IP/포트 범위를 사용하여 A ⊆ B 포함 여부를 판단합니다.
    # 기존 analyze()가 텍스트 완전 일치만 탐지하는 것과 달리, 더 넓은 정책이
    # 좁은 정책을 포함하는 경우도 탐지합니다 (예: 10.0.0.0/8 ⊇ 10.1.0.0/16).
    # ------------------------------------------------------------------

    def _get_addr_ranges(
        self, members: list, direction: str
    ) -> List[Tuple[int, int]]:
        """지정 방향(source/destination)의 정수형 IP 범위 목록을 반환합니다."""
        return [
            (m.ip_start, m.ip_end)
            for m in members
            if m.direction == direction and m.ip_start is not None and m.ip_end is not None
        ]

    def _get_svc_ranges(
        self, members: list
    ) -> List[Tuple[Optional[str], int, int]]:
        """(protocol, port_start, port_end) 튜플 목록을 반환합니다."""
        return [
            (m.protocol, m.port_start, m.port_end)
            for m in members
            if m.port_start is not None and m.port_end is not None
        ]

    def _is_addr_subset(
        self,
        small: List[Tuple[int, int]],
        large: List[Tuple[int, int]],
    ) -> bool:
        """small의 모든 IP 범위가 large의 어느 하나에 포함되는지 확인합니다."""
        if not large:
            return True   # large는 'any' — 모든 주소 포함
        if not small:
            return False  # small은 'any'이지만 large는 구체적 — small이 더 넓음
        for s_start, s_end in small:
            if not any(l_start <= s_start and s_end <= l_end for l_start, l_end in large):
                return False
        return True

    def _is_svc_subset(
        self,
        small: List[Tuple[Optional[str], int, int]],
        large: List[Tuple[Optional[str], int, int]],
    ) -> bool:
        """small의 모든 서비스 범위가 large의 어느 하나에 포함되는지 확인합니다.

        주의: 빈 리스트는 'any'가 아닌 "포트 정보 없음(예: ICMP)" 을 의미합니다.
        'any' 서비스는 (protocol='any', port_start=0, port_end=65535)로 저장됩니다.
        """
        if not large:
            # large가 비어있으면 ICMP 등 포트 없는 서비스만 허용하는 정책.
            # small도 비어있을 때만 True (같은 non-port 서비스끼리).
            return not small
        if not small:
            # small이 비어있는데 large가 포트 기반 서비스 → 포함 불가.
            return False
        for s_proto, s_start, s_end in small:
            covered = False
            for l_proto, l_start, l_end in large:
                proto_ok = l_proto in (None, 'any') or s_proto in (None, 'any') or l_proto == s_proto
                if proto_ok and l_start <= s_start and s_end <= l_end:
                    covered = True
                    break
            if not covered:
                return False
        return True

    @staticmethod
    def _is_text_subset(small_val: Optional[str], large_val: Optional[str]) -> bool:
        """텍스트 필드의 포함 관계를 확인합니다.

        large_val이 any / all / None / 빈 문자열이면 모든 값을 포함 → True.
        small_val이 any인데 large_val이 구체적이면 → False.
        그 외에는 정확히 일치해야 → True.
        """
        def _is_any(v: Optional[str]) -> bool:
            return not v or v.strip().lower() in ('any', 'all')

        if _is_any(large_val):
            return True
        if _is_any(small_val):
            return False
        return (small_val or '').strip() == (large_val or '').strip()

    def _is_logically_contained(self, small: Policy, large: Policy) -> bool:
        """small 정책이 large 정책에 논리적으로 포함되는지 확인합니다 (small ⊆ large)."""
        # 1. 소스 주소
        small_src = self._get_addr_ranges(small.address_members, 'source')
        large_src = self._get_addr_ranges(large.address_members, 'source')
        if not self._is_addr_subset(small_src, large_src):
            return False

        # 2. 목적지 주소
        small_dst = self._get_addr_ranges(small.address_members, 'destination')
        large_dst = self._get_addr_ranges(large.address_members, 'destination')
        if not self._is_addr_subset(small_dst, large_dst):
            return False

        # 3. 서비스
        small_svc = self._get_svc_ranges(small.service_members)
        large_svc = self._get_svc_ranges(large.service_members)
        if not self._is_svc_subset(small_svc, large_svc):
            return False

        # 4. 사용자: large가 any가 아니면 일치해야 함
        if not self._is_text_subset(small.user, large.user):
            return False

        # 5. 애플리케이션
        if not self._is_text_subset(small.application, large.application):
            return False

        # 6. 벤더 특화 필드 (Palo Alto)
        if self.vendor == 'paloalto':
            if not self._is_text_subset(small.vsys, large.vsys):
                return False
            if not self._is_text_subset(small.security_profile, large.security_profile):
                return False
            if not self._is_text_subset(small.category, large.category):
                return False

        return True

    async def analyze_logical(self) -> List[RedundancyPolicySetCreate]:
        """
        논리적 포함 관계 기반 중복 정책 분석.

        fpat RedundancyAnalyzer.analyze_logical()을 FAT DB 구조로 이식.
        seq 순서 기준으로 앞선 정책(base)이 뒤에 오는 정책(target)을 포함하면
        base=UPPER, target=LOWER로 분류합니다.

        기존 analyze()의 텍스트 완전 일치 탐지를 포함하며,
        추가로 IP 서브넷 포함 관계(예: /8 ⊇ /16)까지 탐지합니다.
        """
        device = await crud.device.get_device(self.db, device_id=self.device_id)
        if not device:
            raise ValueError(f"Device ID {self.device_id}를 찾을 수 없습니다.")
        self.vendor = device.vendor

        policies = await self._get_policies_with_members()
        total = len(policies)
        logger.info(f"논리적 포함 관계 분석 시작: {total}개 정책")

        results: List[RedundancyPolicySetCreate] = []
        policy_map: Dict[int, int] = {}   # 정책 index → set_number
        current_set_number = 1

        for i in range(total):
            target = policies[i]
            for j in range(i):
                base = policies[j]
                if self._is_logically_contained(target, base):
                    group_no = policy_map.get(j)
                    if group_no is None:
                        group_no = current_set_number
                        policy_map[j] = group_no
                        results.append(RedundancyPolicySetCreate(
                            task_id=self.task.id,
                            set_number=group_no,
                            type=RedundancyPolicySetType.UPPER,
                            policy_id=base.id,
                        ))
                        current_set_number += 1
                    results.append(RedundancyPolicySetCreate(
                        task_id=self.task.id,
                        set_number=group_no,
                        type=RedundancyPolicySetType.LOWER,
                        policy_id=target.id,
                    ))
                    policy_map[i] = group_no
                    break  # 첫 번째 포함 관계가 확인되면 중단 (fpat 동일 방식)

        logger.info(f"논리적 중복 분석 완료: {len(results)}개 결과")
        return results
