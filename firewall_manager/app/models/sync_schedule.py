from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON
from datetime import datetime
from zoneinfo import ZoneInfo
from app.db.session import Base

class SyncSchedule(Base):
    """
    장비 동기화 스케줄 설정을 위한 모델
    """
    __tablename__ = "sync_schedules"

    id = Column(Integer, primary_key=True, index=True)
    # 스케줄 이름 (고유값)
    name = Column(String, nullable=False, unique=True)
    # 스케줄 활성화 여부
    enabled = Column(Boolean, default=True, nullable=False)
    # 실행 요일 설정: [0,1,2,3,4,5,6] (0=월요일, 6=일요일)
    days_of_week = Column(JSON, nullable=False)  # 예: 평일 동기화의 경우 [0,1,2,3,4]
    # 실행 시간 설정: "HH:MM" 24시간 형식
    time = Column(String, nullable=False)  # 예: "03:00" (새벽 3시)
    # 동기화 대상 장비 ID 목록 (정의된 순서대로 순차 실행)
    device_ids = Column(JSON, nullable=False)  # 예: [1, 2, 5]
    # 스케줄 상세 설명
    description = Column(String, nullable=True)
    
    # 생성 및 수정 시간 (Asia/Seoul 타임존 기준)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), onupdate=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    
    # 마지막 실행 정보
    last_run_at = Column(DateTime, nullable=True)
    last_run_status = Column(String, nullable=True)  # 'success' 또는 'failure'

