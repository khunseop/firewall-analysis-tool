from sqlalchemy import Column, Integer, BigInteger, String, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime

class NetworkObject(Base):
    __tablename__ = "network_objects"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    name = Column(String, index=True, nullable=False)
    ip_address = Column(String, nullable=False)
    type = Column(String, nullable=True)
    description = Column(String, nullable=True)
    # 숫자화된 IP 범위(IPv4 우선). fqdn 등에는 NULL
    ip_version = Column(Integer, nullable=True)  # 4 또는 6
    ip_start = Column(BigInteger, nullable=True)
    ip_end = Column(BigInteger, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    device = relationship("Device")
