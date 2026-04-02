
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
    """
    미사용 정책 분석을 수행하는 클래스입니다.
    
    정책의 마지막 사용 일자(Last Hit Date)를 기준으로 설정된 기간(기본 90일) 동안 
    단 한 번도 사용되지 않은 정책을 탐지합니다.
    """

    def __init__(self, db_session: AsyncSession, task: AnalysisTask, days: int = 90):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.days = days

    async def _get_policies(self) -> List[Policy]:
        """분석 대상이 되는 활성화된 정책 목록을 조회합니다."""
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
        """
        미사용 정책 분석을 실행하고 결과를 반환합니다.
        
        분석 알고리즘:
        1. 현재 시간으로부터 분석 기준일(days)만큼 과거인 '기준 날짜(cutoff_date)'를 계산합니다.
        2. 각 정책의 `last_hit_date` 필드를 확인합니다.
        3. `last_hit_date`가 None이면 '사용 이력 없음'으로 간주합니다.
        4. `last_hit_date`가 기준 날짜보다 이전이면 '장기 미사용'으로 간주합니다.
        """
        logger.info(f"Task ID {self.task.id}에 대한 미사용 정책 분석 시작 (기준: {self.days}일).")

        policies = await self._get_policies()
        
        # 기준 날짜 계산 (현재 시간 - 설정된 일수)
        cutoff_date = datetime.now() - timedelta(days=self.days)
        
        results = []
        for policy in policies:
            is_unused = False
            reason = ""
            
            # 1. 히트 로그가 전혀 없는 경우
            if policy.last_hit_date is None:
                is_unused = True
                reason = "사용 이력 없음"
            # 2. 마지막 히트 이후 설정된 기간이 경과한 경우
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

