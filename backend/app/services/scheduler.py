import logging
import asyncio
from typing import Dict, List, Optional, Set
from datetime import datetime
from zoneinfo import ZoneInfo
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.db.session import SessionLocal
from app import crud
from app.services.sync.tasks import run_sync_all_orchestrator
from app.services.audit_log import log_activity

logger = logging.getLogger(__name__)

class SyncScheduler:
    """동기화 스케줄러 관리 클래스"""
    
    def __init__(self):
        self.scheduler: Optional[AsyncIOScheduler] = None
        self.job_ids: Dict[int, str] = {}  # schedule_id -> job_id 매핑
        self.running: Set[int] = set()  # 지금 실행 중인 schedule_id (중복 실행 방지·화면 표시용)
    
    def start(self):
        """스케줄러 시작"""
        if self.scheduler is None:
            self.scheduler = AsyncIOScheduler(timezone=ZoneInfo("Asia/Seoul"))
            self.scheduler.start()
            logger.info("Sync scheduler started")
            # 매일 자정 오래된 알림 로그 자동 정리
            self.scheduler.add_job(
                _cleanup_old_notification_logs,
                CronTrigger(hour=0, minute=0, timezone=ZoneInfo("Asia/Seoul")),
                id="cleanup_notification_logs",
                name="오래된 알림 로그 정리",
                replace_existing=True,
            )
            logger.info("Notification log cleanup job scheduled (daily at midnight)")
    
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
        
        job_id = f"sync_schedule_{schedule.id}"

        # job 추가 — 실행 시점에 DB에서 최신 스케줄(장비 목록 등)을 다시 읽어 실행한다.
        self.scheduler.add_job(
            self.execute_schedule,
            trigger=trigger,
            args=[schedule.id],
            id=job_id,
            name=f"Sync Schedule: {schedule.name}",
            replace_existing=True
        )

        self.job_ids[schedule.id] = job_id
        logger.info(f"Added schedule '{schedule.name}' (ID: {schedule.id}) - Days: {schedule.days_of_week}, Time: {schedule.time}")
    
    def is_running(self, schedule_id: int) -> bool:
        return schedule_id in self.running

    def mark_running(self, schedule_id: int) -> bool:
        """실행 중으로 표시한다. 이미 실행 중이면 False — 같은 스케줄이 겹쳐 실행되지 않게 한다."""
        if schedule_id in self.running:
            return False
        self.running.add(schedule_id)
        return True

    def next_run_time(self, schedule_id: int) -> Optional[datetime]:
        """다음 실행 예정 시각(Asia/Seoul, tz 정보 없는 값). 비활성이거나 등록되지 않았으면 None."""
        job_id = self.job_ids.get(schedule_id)
        if not self.scheduler or not job_id:
            return None
        job = self.scheduler.get_job(job_id)
        next_time = getattr(job, "next_run_time", None) if job else None
        return next_time.astimezone(ZoneInfo("Asia/Seoul")).replace(tzinfo=None) if next_time else None

    async def _sync_one_device(self, device_id: int) -> dict:
        """장비 1대를 동기화하고 결과를 돌려준다.

        오케스트레이터는 실패를 예외로 던지지 않고 장비의 last_sync_status에 기록하므로,
        예외 유무가 아니라 끝난 뒤의 장비 상태로 성공 여부를 판단한다.
        """
        name = f"장비 {device_id}"
        error: Optional[str] = None
        try:
            await run_sync_all_orchestrator(device_id)
        except Exception as e:
            logger.error(f"Failed to sync device_id={device_id}: {e}", exc_info=True)
            error = str(e) or e.__class__.__name__
        async with SessionLocal() as db:
            device = await crud.device.get_device(db, device_id=device_id)
            if not device:
                return {"device_id": device_id, "device_name": name, "status": "failure", "error": "장비를 찾을 수 없습니다."}
            name = device.name
            if error is None and device.last_sync_status != "success":
                step = f" (단계: {device.last_sync_step})" if device.last_sync_step else ""
                error = "동기화가 완료되지 않았습니다." + step if device.last_sync_status == "in_progress" else "동기화에 실패했습니다." + step
        return {"device_id": device_id, "device_name": name, "status": "failure" if error else "success", "error": error}

    async def execute_schedule(self, schedule_id: int, already_marked: bool = False) -> None:
        """스케줄에 속한 장비를 순서대로 동기화하고 장비별 결과를 기록한다. 예약 실행과 '지금 실행'이 공유한다."""
        if not already_marked and not self.mark_running(schedule_id):
            logger.warning(f"Schedule (ID: {schedule_id}) is already running — skipped")
            return
        try:
            async with SessionLocal() as db:
                schedule = await crud.sync_schedule.get_sync_schedule(db, schedule_id)
                if not schedule:
                    return
                name, device_ids = schedule.name, list(schedule.device_ids)
            logger.info(f"Running scheduled sync for schedule '{name}' (ID: {schedule_id})")

            results: List[dict] = []
            for device_id in device_ids:
                results.append(await self._sync_one_device(device_id))

            failed = [r for r in results if r["status"] != "success"]
            status = "success" if not failed else ("failure" if len(failed) == len(results) else "partial")
            async with SessionLocal() as db:
                await crud.sync_schedule.update_schedule_run_status(db, schedule_id, status, results)
                detail = ", ".join(f"{r['device_name']}: {r['error']}" for r in failed)
                await log_activity(
                    db,
                    title="동기화 스케줄 실행 완료" if status == "success" else "동기화 스케줄 실행 일부 실패" if status == "partial" else "동기화 스케줄 실행 실패",
                    message=f"스케줄 '{name}' — 성공 {len(results) - len(failed)}대 / 실패 {len(failed)}대" + (f" ({detail})" if detail else ""),
                    type="success" if status == "success" else "warning" if status == "partial" else "error",
                    category="schedule",
                )
            logger.info(f"Scheduled sync finished for '{name}': {status}")
        except Exception as e:
            logger.error(f"Scheduled sync failed for schedule_id={schedule_id}: {e}", exc_info=True)
            async with SessionLocal() as db2:
                await crud.sync_schedule.update_schedule_run_status(
                    db2, schedule_id, "failure", [{"device_id": None, "device_name": "-", "status": "failure", "error": str(e) or e.__class__.__name__}]
                )
        finally:
            self.running.discard(schedule_id)

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

async def _cleanup_old_notification_logs():
    """설정에 저장된 보존 기간을 읽어 오래된 알림 로그를 삭제"""
    async with SessionLocal() as db:
        try:
            setting = await crud.settings.get_setting(db, 'notification_log_retention_days')
            days = int(setting.value) if setting and setting.value else 90
        except Exception:
            days = 90
        try:
            deleted = await crud.notification_log.delete_old_logs(db, older_than_days=days)
            if deleted:
                logger.info(f"Auto-cleanup: deleted {deleted} notification logs older than {days} days")
        except Exception as e:
            logger.error(f"Auto-cleanup notification logs failed: {e}", exc_info=True)


# 전역 스케줄러 인스턴스
sync_scheduler = SyncScheduler()

