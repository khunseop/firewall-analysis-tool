from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.models.analysis import TaskStatus

# Base schema for AnalysisTask
class AnalysisTaskBase(BaseModel):
    device_id: int
    task_type: str
    status: TaskStatus = TaskStatus.PENDING
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    logs: Optional[str] = None

# Schema for creating a new AnalysisTask
class AnalysisTaskCreate(AnalysisTaskBase):
    pass

# Schema for reading AnalysisTask data from DB
class AnalysisTask(AnalysisTaskBase):
    id: int

    class Config:
        from_attributes = True

# Base schema for RedundancyPolicySet
class RedundancyPolicySetBase(BaseModel):
    set_number: int
    type: str  # "Upper" or "Lower"
    policy_id: int
    vsys: Optional[str] = None
    seq: Optional[int] = None
    rule_name: str
    enable: Optional[str] = None
    action: str
    source: str
    user: Optional[str] = None
    destination: str
    service: str
    application: Optional[str] = None
    security_profile: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None

# Schema for creating a new RedundancyPolicySet
class RedundancyPolicySetCreate(RedundancyPolicySetBase):
    task_id: int

# Schema for reading RedundancyPolicySet data from DB
class RedundancyPolicySet(RedundancyPolicySetBase):
    id: int
    task_id: int

    class Config:
        from_attributes = True
