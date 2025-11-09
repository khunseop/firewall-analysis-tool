import logging
import asyncio
from typing import Dict, Optional
from datetime import datetime
from zoneinfo import ZoneInfo
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.db.session import SessionLocal
from app import crud
from app.services.sync.tasks import run_sync_all_orchestrator

logger = logging.getLogger(__name__)

class SyncScheduler:
    """동기화 스케줄러 관리 클래스"""
    
    def __init__(self):
        self.scheduler: Optional[AsyncIOScheduler] = None
        self.job_ids: Dict[int, str] = {}  # schedule_id -> job_id 매핑
    
    def start(self):
        """스케줄러 시작"""
        if self.scheduler is None:
            self.scheduler = AsyncIOScheduler(timezone=ZoneInfo("Asia/Seoul"))
            self.scheduler.start()
            logger.info("Sync scheduler started")
    
    def stop(self):
        """스케줄러 중지"""
        if self.scheduler:
            self.scheduler.shutdown()
            self.scheduler = None
            self.job_ids.clear()
            logger.info("Sync scheduler stopped")
    
    async def load_schedules(self):
        """DB에서 활성화된 스케줄을 로드하여 스케줄러에 등록"""
        async with SessionLocal() as db:
            schedules = await crud.sync_schedule.get_enabled_sync_schedules(db)
            for schedule in schedules:
                self.add_schedule(schedule)
            logger.info(f"Loaded {len(schedules)} enabled schedules")
    
    def add_schedule(self, schedule):
        """스케줄을 스케줄러에 추가"""
        if not self.scheduler:
            logger.warning("Scheduler not started. Cannot add schedule.")
            return
        
        # 기존 job이 있으면 제거
        if schedule.id in self.job_ids:
            self.remove_schedule(schedule.id)
        
        # cron 표현식 생성
        # days_of_week: [0,1,2,3,4,5,6] (월~일, 0=월요일)
        # APScheduler는 0=월요일, 6=일요일 사용
        days_str = ','.join(str(d) for d in schedule.days_of_week)
        
        # 시간 파싱
        hour, minute = map(int, schedule.time.split(':'))
        
        # cron 트리거 생성
        trigger = CronTrigger(
            day_of_week=days_str,
            hour=hour,
            minute=minute,
            timezone=ZoneInfo("Asia/Seoul")
        )
        
        # job 함수 생성 (장비 ID 목록을 순서대로 전달)
        job_id = f"sync_schedule_{schedule.id}"
        
        async def run_scheduled_sync():
            """스케줄된 동기화 실행"""
            logger.info(f"Running scheduled sync for schedule '{schedule.name}' (ID: {schedule.id})")
            async with SessionLocal() as db:
                try:
                    # 장비들을 순서대로 동기화
                    for device_id in schedule.device_ids:
                        logger.info(f"Starting sync for device_id={device_id} (schedule: {schedule.name})")
                        try:
                            await run_sync_all_orchestrator(device_id)
                            logger.info(f"Completed sync for device_id={device_id} (schedule: {schedule.name})")
                        except Exception as e:
                            logger.error(f"Failed to sync device_id={device_id} (schedule: {schedule.name}): {e}", exc_info=True)
                    
                    # 성공 상태 업데이트
                    await crud.sync_schedule.update_schedule_run_status(db, schedule.id, "success")
                    logger.info(f"Scheduled sync completed successfully for '{schedule.name}'")
                except Exception as e:
                    logger.error(f"Scheduled sync failed for '{schedule.name}': {e}", exc_info=True)
                    async with SessionLocal() as db2:
                        await crud.sync_schedule.update_schedule_run_status(db2, schedule.id, "failure")
        
        # job 추가
        self.scheduler.add_job(
            run_scheduled_sync,
            trigger=trigger,
            id=job_id,
            name=f"Sync Schedule: {schedule.name}",
            replace_existing=True
        )
        
        self.job_ids[schedule.id] = job_id
        logger.info(f"Added schedule '{schedule.name}' (ID: {schedule.id}) - Days: {schedule.days_of_week}, Time: {schedule.time}")
    
    def remove_schedule(self, schedule_id: int):
        """스케줄을 스케줄러에서 제거"""
        if not self.scheduler:
            return
        
        if schedule_id in self.job_ids:
            job_id = self.job_ids[schedule_id]
            try:
                self.scheduler.remove_job(job_id)
                del self.job_ids[schedule_id]
                logger.info(f"Removed schedule (ID: {schedule_id})")
            except Exception as e:
                logger.warning(f"Failed to remove schedule (ID: {schedule_id}): {e}")
    
    async def update_schedule(self, schedule):
        """스케줄 업데이트 (DB에서 최신 정보 로드)"""
        # DB에서 최신 정보 로드
        async with SessionLocal() as db:
            latest_schedule = await crud.sync_schedule.get_sync_schedule(db, schedule.id)
            if not latest_schedule:
                self.remove_schedule(schedule.id)
                return
        
        if latest_schedule.enabled:
            self.add_schedule(latest_schedule)
        else:
            self.remove_schedule(latest_schedule.id)

# 전역 스케줄러 인스턴스
sync_scheduler = SyncScheduler()

