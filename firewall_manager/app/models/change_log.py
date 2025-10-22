from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey
from app.db.session import Base
from datetime import datetime

class ChangeLog(Base):
    __tablename__ = "change_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    data_type = Column(String, nullable=False)
    object_name = Column(String, nullable=False)
    action = Column(String, nullable=False)  # "created", "updated", "deleted"
    details = Column(JSON, nullable=True)
