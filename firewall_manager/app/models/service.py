from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Boolean
from sqlalchemy.dialects.sqlite import INTEGER as SQLITE_INTEGER
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo

class Service(Base):
    """
    방화벽에서 수집된 개별 서비스(Service Object, 예: TCP 80) 정보를 저장하는 모델입니다.
    
    Relations:
        - Device (1:N): 특정 장비에 소속된 서비스 객체입니다.
    """
    __tablename__ = "services"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    name = Column(String, index=True, nullable=False)
    
    # 원본 프로토콜 및 포트 정보
    protocol = Column(String, nullable=True)
    port = Column(String, nullable=True)
    description = Column(String, nullable=True)
    
    # 분석 및 검색 고속화를 위한 숫자형 포트 범위 정보
    # 'any' 프로토콜의 경우 0-65535로 변환되어 저장됩니다.
    port_start = Column(Integer, nullable=True)
    port_end = Column(Integer, nullable=True)
    
    # 논리적 삭제 및 활성 상태 관리
    is_active = Column(Boolean, default=True, nullable=False)
    
    # 마지막 수집 확인 시간 (삭제된 서비스 식별용)
    last_seen_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)

    device = relationship("Device")
