from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, JSON
from sqlalchemy.orm import relationship
from app.db.session import Base
import enum
import datetime
from zoneinfo import ZoneInfo

class AnalysisTaskType(str, enum.Enum):
    REDUNDANCY = "redundancy"
    UNUSED = "unused"
    IMPACT = "impact"
    UNREFERENCED_OBJECTS = "unreferenced_objects"
    RISKY_PORTS = "risky_ports"
    OVER_PERMISSIVE = "over_permissive"

class AnalysisTaskStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    SUCCESS = "success"
    FAILURE = "failure"

class RedundancyPolicySetType(str, enum.Enum):
    UPPER = "UPPER"
    LOWER = "LOWER"

class AnalysisTask(Base):
    __tablename__ = "analysistasks"
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    task_type = Column(Enum(AnalysisTaskType), nullable=False)
    task_status = Column(Enum(AnalysisTaskStatus), nullable=False, default=AnalysisTaskStatus.PENDING)
    created_at = Column(DateTime, nullable=False)
    started_at = Column(DateTime)
    completed_at = Column(DateTime)

    device = relationship("Device")

class RedundancyPolicySet(Base):
    __tablename__ = "redundancypolicysets"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("analysistasks.id", ondelete="CASCADE"), nullable=False)
    set_number = Column(Integer, nullable=False, index=True)
    type = Column(Enum(RedundancyPolicySetType), nullable=False)
    policy_id = Column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), nullable=False)

    task = relationship("AnalysisTask")
    policy = relationship("Policy", back_populates="redundancy_policy_sets")

class AnalysisResult(Base):
    __tablename__ = 'analysis_results'

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey('devices.id'), nullable=False, index=True)
    analysis_type = Column(String, nullable=False, index=True)
    result_data = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), onupdate=lambda: datetime.datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None))

    device = relationship("Device")
