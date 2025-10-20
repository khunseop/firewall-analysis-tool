from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base

class Policy(Base):
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    rule_name = Column(String, index=True)
    source_ip = Column(String)
    destination_ip = Column(String)
    service = Column(String)
    action = Column(String)
    description = Column(String, nullable=True)

    device = relationship("Device")
