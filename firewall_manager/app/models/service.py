from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Boolean
from sqlalchemy.dialects.sqlite import INTEGER as SQLITE_INTEGER
from sqlalchemy.orm import relationship
from app.db.session import Base
from app.core.config import get_now_in_seoul

class Service(Base):
    __tablename__ = "services"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    name = Column(String, index=True, nullable=False)
    protocol = Column(String, nullable=True)
    port = Column(String, nullable=True)
    description = Column(String, nullable=True)
    # 숫자화된 포트 범위 (any는 0-65535)
    port_start = Column(Integer, nullable=True)
    port_end = Column(Integer, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    last_seen_at = Column(DateTime, default=get_now_in_seoul, nullable=False)

    device = relationship("Device")
