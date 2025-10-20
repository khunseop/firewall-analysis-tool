from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base

class NetworkObject(Base):
    __tablename__ = "network_objects"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    name = Column(String, index=True)
    ip_address = Column(String)
    description = Column(String, nullable=True)

    device = relationship("Device")
