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
        self.vendor = ""  # Dispositivo থেকে 가져올 예정

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

        # 주소 멤버들을 방향에 따라 정렬된 튜플로 변환
        src_addrs = tuple(sorted([
            f"{m.ip_start}-{m.ip_end}" for m in policy.address_members if m.direction == 'source'
        ]))
        dst_addrs = tuple(sorted([
            f"{m.ip_start}-{m.ip_end}" for m in policy.address_members if m.direction == 'destination'
        ]))

        # 서비스 멤버들을 프로토콜과 포트에 따라 정렬된 튜플로 변환
        services = tuple(sorted([
            f"{m.protocol}/{m.port_start}-{m.port_end}" for m in policy.service_members
        ]))

        # 벤더별로 비교할 컬럼들을 튜플로 묶음
        if self.vendor == 'paloalto':
            key = (
                policy.action,
                src_addrs,
                policy.user,
                dst_addrs,
                services,
                policy.application,
                policy.security_profile,
                policy.category,
                policy.vsys,
            )
        else: # 'ngf' 및 기본값
            key = (
                policy.action,
                src_addrs,
                policy.user,
                dst_addrs,
                services,
                policy.application,
            )
        return key

    async def analyze(self):
        """중복 정책 분석을 실행합니다."""
        logger.info(f"Task ID {self.task.id}에 대한 중복 정책 분석 시작.")

        device = await crud.device.get_device(self.db, device_id=self.device_id)
        if not device:
            raise ValueError(f"Device ID {self.device_id}를 찾을 수 없습니다.")
        self.vendor = device.vendor

        policies = await self._get_policies_with_members()

        policy_map: Dict[Tuple, int] = {}
        results_to_create: List[RedundancyPolicySetCreate] = []

        upper_rules: Dict[int, RedundancyPolicySetCreate] = {}
        lower_rules_count: Dict[int, int] = defaultdict(int)

        current_set_number = 1

        logger.info("정책 중복 여부 확인 중...")
        for policy in policies:
            key = self._normalize_policy_key(policy)

            if key in policy_map:
                # 중복 발견 (Lower Rule)
                set_number = policy_map[key]
                result = RedundancyPolicySetCreate(
                    task_id=self.task.id,
                    set_number=set_number,
                    type=RedundancyPolicySetType.LOWER,
                    policy_id=policy.id
                )
                results_to_create.append(result)
                lower_rules_count[set_number] += 1
            else:
                # 새로운 정책 (Upper Rule)
                policy_map[key] = current_set_number
                result = RedundancyPolicySetCreate(
                    task_id=self.task.id,
                    set_number=current_set_number,
                    type=RedundancyPolicySetType.UPPER,
                    policy_id=policy.id
                )
                upper_rules[current_set_number] = result
                current_set_number += 1

        logger.info("분석 완료. 결과 저장 준비 중...")

        # Lower Rule이 있는 Upper Rule만 최종 결과에 추가
        final_results = []
        for set_num, upper_rule in upper_rules.items():
            if lower_rules_count[set_num] > 0:
                final_results.append(upper_rule)

        final_results.extend([
            r for r in results_to_create if r.type == RedundancyPolicySetType.LOWER
        ])

        if not final_results:
            logger.info("중복 정책이 발견되지 않았습니다.")
            return

        # 결과를 DB에 저장
        logger.info(f"{len(final_results)}개의 중복 분석 결과를 저장합니다.")
        await crud.analysis.create_redundancy_policy_sets(self.db, sets_in=final_results)
        logger.info("중복 정책 분석 결과 저장 완료.")
