from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text, Enum
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo
import enum

class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    SUCCESS = "success"
    FAILURE = "failure"

class AnalysisTask(Base):
    __tablename__ = "analysis_tasks"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    task_type = Column(String, nullable=False) # e.g., "redundancy"
    status = Column(Enum(TaskStatus), default=TaskStatus.PENDING, nullable=False)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    logs = Column(Text, nullable=True)

    device = relationship("Device")
    redundancy_results = relationship("RedundancyPolicySet", back_populates="task")

class RedundancyPolicySet(Base):
    __tablename__ = "redundancy_policy_sets"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("analysis_tasks.id"), nullable=False)
    set_number = Column(Integer, nullable=False, index=True)
    type = Column(String, nullable=False)  # "Upper" or "Lower"

    # Fields from Policy model
    policy_id = Column(Integer, nullable=False)
    vsys = Column(String, nullable=True)
    seq = Column(Integer, nullable=True)
    rule_name = Column(String, index=True, nullable=False)
    enable = Column(String, nullable=True)
    action = Column(String, nullable=False)
    source = Column(String, nullable=False)
    user = Column(String, nullable=True)
    destination = Column(String, nullable=False)
    service = Column(String, nullable=False)
    application = Column(String, nullable=True)
    security_profile = Column(String, nullable=True)
    category = Column(String, nullable=True)
    description = Column(String, nullable=True)

    task = relationship("AnalysisTask", back_populates="redundancy_results")
