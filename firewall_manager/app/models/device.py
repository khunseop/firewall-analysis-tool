from sqlalchemy import Column, Integer, String, DateTime
from app.db.session import Base

class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False, unique=True)
    ip_address = Column(String, nullable=False, unique=True)
    secondary_ip_address = Column(String, nullable=True)
    vendor = Column(String, nullable=False)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)
    description = Column(String, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String, nullable=True)
