
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
    """중복 정책 분석을 위한 클래스 (DB 버전)"""

    def __init__(self, db_session: AsyncSession, task: AnalysisTask):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.vendor = ""

    async def _get_policies_with_members(self) -> List[Policy]:
        """분석에 필요한 정책과 멤버 데이터를 DB에서 조회합니다."""
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
        """정책의 중복 여부를 판단하기 위한 고유 키를 생성합니다."""
        # Source addresses: include IP ranges and empty group tokens
        src_addrs = []
        for m in policy.address_members:
            if m.direction == 'source':
                if m.ip_start is not None and m.ip_end is not None:
                    src_addrs.append(f"{m.ip_start}-{m.ip_end}")
                elif m.token and m.token_type == 'unknown':  # Empty group
                    src_addrs.append(f"__GROUP__:{m.token}")
        src_addrs = tuple(sorted(src_addrs))
        
        # Destination addresses: include IP ranges and empty group tokens
        dst_addrs = []
        for m in policy.address_members:
            if m.direction == 'destination':
                if m.ip_start is not None and m.ip_end is not None:
                    dst_addrs.append(f"{m.ip_start}-{m.ip_end}")
                elif m.token and m.token_type == 'unknown':  # Empty group
                    dst_addrs.append(f"__GROUP__:{m.token}")
        dst_addrs = tuple(sorted(dst_addrs))
        
        # Services: include port ranges and empty group tokens
        services = []
        for m in policy.service_members:
            if m.port_start is not None and m.port_end is not None:
                services.append(f"{m.protocol}/{m.port_start}-{m.port_end}")
            elif m.token and m.token_type == 'unknown':  # Empty group
                services.append(f"__GROUP__:{m.token}")
        services = tuple(sorted(services))

        key_fields = [policy.action, src_addrs, policy.user, dst_addrs, services, policy.application]
        if self.vendor == 'paloalto':
            key_fields.extend([policy.security_profile, policy.category, policy.vsys])

        return tuple(key_fields)

    async def analyze(self) -> List[RedundancyPolicySetCreate]:
        """중복 정책 분석을 실행하고 결과를 반환합니다."""
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
        for set_num, upper_rule in upper_rules.items():
            if lower_rules_count[set_num] > 0:
                final_results.append(upper_rule)

        final_results.extend([
            r for r in temp_results if r.type == RedundancyPolicySetType.LOWER
        ])

        if not final_results:
            logger.info("중복 정책이 발견되지 않았습니다.")
            return []

        logger.info(f"{len(final_results)}개의 중복 분석 결과를 찾았습니다.")
        return final_results
