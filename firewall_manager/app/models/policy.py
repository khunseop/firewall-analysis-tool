from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship
from ..database import Base

class Policy(Base):
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("firewall_devices.id"), nullable=False)
    name = Column(String, index=True)
    source_ip = Column(String)
    destination_ip = Column(String)
    service = Column(String)
    action = Column(String)
    raw_policy = Column(Text) # 원본 정책 텍스트

    device = relationship("FirewallDevice")