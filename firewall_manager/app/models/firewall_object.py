from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship
from ..database import Base

class FirewallObject(Base):
    __tablename__ = "firewall_objects"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("firewall_devices.id"), nullable=False)
    name = Column(String, index=True)
    object_type = Column(String) # 예: 'address', 'service'
    value = Column(Text) # 예: '1.1.1.1/32', 'tcp/80'

    device = relationship("FirewallDevice")