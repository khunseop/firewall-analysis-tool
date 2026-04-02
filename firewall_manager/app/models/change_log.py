from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo

class ChangeLog(Base):
    """
    방화벽 장비 내의 객체(정책, 네트워크, 서비스 등) 변경 이력을 기록하는 모델입니다.
    
    Relations:
        - Device (N:1): 특정 장비에서 발생한 변경 이력입니다.
    """
    __tablename__ = "change_logs"

    id = Column(Integer, primary_key=True, index=True)
    
    # 변경 발생 시간 (한국 시간)
    timestamp = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    
    # 데이터 종류 (Policy, NetworkObject, Service 등)
    data_type = Column(String, nullable=False)
    
    # 변경된 객체의 이름
    object_name = Column(String, nullable=False)
    
    # 수행된 작업 (created, updated, deleted)
    action = Column(String, nullable=False)
    
    # 변경 상세 정보 (JSON)
    details = Column(JSON, nullable=True)

    device = relationship("Device")
