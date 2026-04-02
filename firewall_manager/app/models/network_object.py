from sqlalchemy import Column, Integer, BigInteger, String, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo

class NetworkObject(Base):
    """
    방화벽에서 수집된 개별 네트워크 객체(Address Object) 정보를 저장하는 모델입니다.
    
    Relations:
        - Device (1:N): 특정 장비에 소속된 객체입니다.
    """
    __tablename__ = "network_objects"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    name = Column(String, index=True, nullable=False)
    ip_address = Column(String, nullable=False)
    type = Column(String, nullable=True)  # ip-mask, ip-range, fqdn 등
    description = Column(String, nullable=True)
    
    # 분석 및 검색 고속화를 위한 숫자형 IP 범위 정보
    ip_version = Column(Integer, nullable=True)  # 4 또는 6
    ip_start = Column(BigInteger, nullable=True)
    ip_end = Column(BigInteger, nullable=True)
    
    # 논리적 삭제 및 활성 상태 관리
    is_active = Column(Boolean, default=True, nullable=False)
    
    # 마지막 수집 확인 시간 (삭제된 객체 식별용)
    last_seen_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)

    device = relationship("Device")
