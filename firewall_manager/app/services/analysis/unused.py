
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Policy, AnalysisTask
from app.schemas.analysis import AnalysisResultCreate

logger = logging.getLogger(__name__)


class UnusedPolicyAnalyzer:
    """미사용 정책 분석을 위한 클래스"""

    def __init__(self, db_session: AsyncSession, task: AnalysisTask, days: int = 90):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.days = days

    async def _get_policies(self) -> List[Policy]:
        """분석 대상 정책을 조회합니다."""
        logger.info("미사용 정책 분석 대상 데이터 조회 시작...")
        stmt = (
            select(Policy)
            .where(
                Policy.device_id == self.device_id,
                Policy.enable == True
            )
            .order_by(Policy.seq)
        )
        result = await self.db.execute(stmt)
        policies = result.scalars().all()
        logger.info(f"총 {len(policies)}개의 정책이 조회되었습니다.")
        return policies

    async def analyze(self) -> List[Dict[str, Any]]:
        """미사용 정책 분석을 실행하고 결과를 반환합니다."""
        logger.info(f"Task ID {self.task.id}에 대한 미사용 정책 분석 시작 (기준: {self.days}일).")

        policies = await self._get_policies()
        
        # 기준 날짜 계산
        cutoff_date = datetime.now() - timedelta(days=self.days)
        
        results = []
        for policy in policies:
            # 미사용 정책 판단 기준:
            # 1. last_hit_date가 None인 경우
            # 2. last_hit_date가 기준 날짜보다 이전인 경우
            is_unused = False
            reason = ""
            
            if policy.last_hit_date is None:
                is_unused = True
                reason = "사용 이력 없음"
            elif policy.last_hit_date < cutoff_date:
                days_unused = (datetime.now() - policy.last_hit_date).days
                is_unused = True
                reason = f"{days_unused}일 미사용"
            
            if is_unused:
                days_unused = None
                if policy.last_hit_date:
                    days_unused = (datetime.now() - policy.last_hit_date).days
                
                results.append({
                    "policy_id": policy.id,
                    "policy": policy,
                    "reason": reason,
                    "last_hit_date": policy.last_hit_date.isoformat() if policy.last_hit_date else None,
                    "days_unused": days_unused
                })

        logger.info(f"{len(results)}개의 미사용 정책이 발견되었습니다.")
        return results

