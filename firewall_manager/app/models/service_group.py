from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime

class ServiceGroup(Base):
    __tablename__ = "service_groups"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    name = Column(String, index=True, nullable=False)
    members = Column(String, nullable=True)
    description = Column(String, nullable=True)

    device = relationship("Device")
