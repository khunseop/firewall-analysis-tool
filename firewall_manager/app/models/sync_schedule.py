from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON
from datetime import datetime
from zoneinfo import ZoneInfo
from app.db.session import Base

class SyncSchedule(Base):
    __tablename__ = "sync_schedules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    enabled = Column(Boolean, default=True, nullable=False)
    # 요일: [0,1,2,3,4,5,6] (월~일, 0=월요일)
    days_of_week = Column(JSON, nullable=False)  # e.g., [0,1,2,3,4] for Mon-Fri
    # 시간: "HH:MM" 형식
    time = Column(String, nullable=False)  # e.g., "09:00"
    # 장비 ID 목록 (순서대로 동기화)
    device_ids = Column(JSON, nullable=False)  # e.g., [1,2,3]
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), onupdate=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    last_run_at = Column(DateTime, nullable=True)
    last_run_status = Column(String, nullable=True)  # success, failure

