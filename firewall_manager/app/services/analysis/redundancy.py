
import logging
from collections import defaultdict
from typing import Dict, List, Tuple

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

    def _normalize_policy_key(self, policy: Policy) -> Tuple:
        """
        정책의 중복 여부를 판단하기 위한 정규화된 고유 키를 생성합니다.
        
        알고리즘:
        1. 출발지/목적지 주소: IP 범위를 문자열(start-end)로 변환하고 정렬하여 튜플 생성.
        2. 서비스: 프로토콜과 포트 범위를 결합하여 정렬된 튜플 생성.
        3. 기타 필드: Action, User, Application 등을 포함.
        4. 벤더별 특성: Palo Alto 등의 경우 Security Profile, Category 등을 키에 추가.
        """
        # 출발지 주소: IP 범위 및 빈 그룹 토큰 포함
        src_addrs = []
        for m in policy.address_members:
            if m.direction == 'source':
                if m.ip_start is not None and m.ip_end is not None:
                    src_addrs.append(f"{m.ip_start}-{m.ip_end}")
                elif m.token and m.token_type == 'unknown':  # 빈 그룹 처리
                    src_addrs.append(f"__GROUP__:{m.token}")
        src_addrs = tuple(sorted(src_addrs))
        
        # 목적지 주소: IP 범위 및 빈 그룹 토큰 포함
        dst_addrs = []
        for m in policy.address_members:
            if m.direction == 'destination':
                if m.ip_start is not None and m.ip_end is not None:
                    dst_addrs.append(f"{m.ip_start}-{m.ip_end}")
                elif m.token and m.token_type == 'unknown':  # 빈 그룹 처리
                    dst_addrs.append(f"__GROUP__:{m.token}")
        dst_addrs = tuple(sorted(dst_addrs))
        
        # 서비스: 포트 범위 및 빈 그룹 토큰 포함
        services = []
        for m in policy.service_members:
            if m.port_start is not None and m.port_end is not None:
                services.append(f"{m.protocol}/{m.port_start}-{m.port_end}")
            elif m.token and m.token_type == 'unknown':  # 빈 그룹 처리
                services.append(f"__GROUP__:{m.token}")
        services = tuple(sorted(services))

        # 기본 비교 필드 구성
        key_fields = [policy.action, src_addrs, policy.user, dst_addrs, services, policy.application]
        
        # 벤더 특화 필드 추가
        if self.vendor == 'paloalto':
            key_fields.extend([policy.security_profile, policy.category, policy.vsys])

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
