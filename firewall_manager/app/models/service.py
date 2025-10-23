from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime

class Service(Base):
    __tablename__ = "services"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    name = Column(String, index=True, nullable=False)
    protocol = Column(String, nullable=True)
    port = Column(String, nullable=True)
    description = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    device = relationship("Device")
