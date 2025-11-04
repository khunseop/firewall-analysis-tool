from sqlalchemy import Column, Integer, String, DateTime, Boolean
from app.db.session import Base

class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False, unique=True)
    ip_address = Column(String, nullable=False, unique=True)
    vendor = Column(String, nullable=False)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)
    description = Column(String, nullable=True)
    ha_peer_ip = Column(String, nullable=True)
    use_ssh_for_last_hit_date = Column(Boolean, nullable=True, default=False)
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String, nullable=True)  # e.g., in_progress, success, failure
    last_sync_step = Column(String, nullable=True)   # e.g., collecting policies, indexing, etc.
