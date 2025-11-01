from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from app.models.analysis import AnalysisTaskStatus, AnalysisTaskType, RedundancyPolicySetType
from .policy import Policy

class AnalysisTaskBase(BaseModel):
    device_id: int
    task_type: AnalysisTaskType

class AnalysisTaskCreate(AnalysisTaskBase):
    created_at: datetime

class AnalysisTaskUpdate(BaseModel):
    task_status: Optional[AnalysisTaskStatus] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

class AnalysisTask(AnalysisTaskBase):
    id: int
    task_status: AnalysisTaskStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class RedundancyPolicySetBase(BaseModel):
    task_id: int
    set_number: int
    type: RedundancyPolicySetType
    policy_id: int

class RedundancyPolicySetCreate(RedundancyPolicySetBase):
    pass

class RedundancyPolicySet(RedundancyPolicySetBase):
    id: int
    policy: Policy

    class Config:
        from_attributes = True
