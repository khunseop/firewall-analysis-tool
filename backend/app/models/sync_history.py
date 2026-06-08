from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo


class SyncHistory(Base):
    __tablename__ = "sync_histories"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False, index=True)
    sync_at = Column(
        DateTime,
        default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None),
        nullable=False,
        index=True,
    )
    total_policies = Column(Integer, nullable=True)
    created_count = Column(Integer, default=0)
    updated_count = Column(Integer, default=0)
    deleted_count = Column(Integer, default=0)

    device = relationship("Device")
