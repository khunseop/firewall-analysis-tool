from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo

class Policy(Base):
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    vsys = Column(String, nullable=True)
    seq = Column(Integer, nullable=True)
    rule_name = Column(String, index=True, nullable=False)
    enable = Column(Boolean(create_constraint=False), nullable=True)
    action = Column(String, nullable=False)
    source = Column(String, nullable=False)
    user = Column(String, nullable=True)
    destination = Column(String, nullable=False)
    service = Column(String, nullable=False)
    application = Column(String, nullable=True)
    security_profile = Column(String, nullable=True)
    category = Column(String, nullable=True)
    description = Column(String, nullable=True)
    # 정책 사용이력의 마지막 히트 시간
    last_hit_date = Column(DateTime, nullable=True)
    is_active = Column(Boolean(create_constraint=False), default=True, nullable=False)
    # 시스템 시간(한국시간)으로 저장하기 위해 default는 런타임에서 주입
    last_seen_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)

    device = relationship("Device")
