from sqlalchemy import Column, Integer, String, DateTime, Text
from app.db.session import Base
from datetime import datetime

class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String, nullable=False, index=True)  # 'info', 'success', 'warning', 'error'
    category = Column(String, nullable=True, index=True)  # 'sync', 'analysis', 'system'
    device_id = Column(Integer, nullable=True, index=True)  # 관련 장비 ID (선택)
    device_name = Column(String, nullable=True)  # 장비 이름 (캐시용)

