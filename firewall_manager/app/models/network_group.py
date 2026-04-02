from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo

class NetworkGroup(Base):
    """
    방화벽에서 수집된 네트워크 그룹(Address Group) 정보를 저장하는 모델입니다.
    
    Relations:
        - Device (1:N): 특정 장비에 소속된 그룹입니다.
    """
    __tablename__ = "network_groups"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    name = Column(String, index=True, nullable=False)
    
    # 그룹 멤버 리스트 (쉼표 또는 개행 등으로 구분된 문자열)
    members = Column(String, nullable=True)
    description = Column(String, nullable=True)
    
    # 논리적 삭제 및 활성 상태 관리
    is_active = Column(Boolean, default=True, nullable=False)
    
    # 마지막 수집 확인 시간 (삭제된 그룹 식별용)
    last_seen_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)

    device = relationship("Device")
