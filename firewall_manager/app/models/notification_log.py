from sqlalchemy import Column, Integer, String, DateTime, Text
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo

class NotificationLog(Base):
    """
    시스템 및 동기화, 분석 작업 중에 발생하는 알림 로그를 저장하는 모델입니다.
    사용자에게 대시보드나 알림창을 통해 정보를 제공할 때 사용됩니다.
    """
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, index=True)
    
    # 알림 발생 시간
    timestamp = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False, index=True)
    
    # 제목 및 본문
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    
    # 알림 심각도 수준 (info, success, warning, error)
    type = Column(String, nullable=False, index=True)
    
    # 알림 카테고리 (sync, analysis, system)
    category = Column(String, nullable=True, index=True)
    
    # 관련 장비 정보 (선택적)
    device_id = Column(Integer, nullable=True, index=True)
    device_name = Column(String, nullable=True)

