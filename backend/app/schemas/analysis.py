
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Any, List
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
    error_message: Optional[str] = None

class AnalysisTask(AnalysisTaskBase):
    id: int
    task_status: AnalysisTaskStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None

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

# Schemas for AnalysisResult
class AnalysisResultBase(BaseModel):
    device_id: int
    analysis_type: str
    result_data: Any
    task_id: Optional[int] = None

class AnalysisResultCreate(AnalysisResultBase):
    pass

class AnalysisResultUpdate(AnalysisResultBase):
    pass

class AnalysisResultInDBBase(AnalysisResultBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

class AnalysisResult(AnalysisResultInDBBase):
    pass

# Schemas for AnalysisTask 게시판(목록) 조회
class AnalysisTaskListItem(BaseModel):
    """분석 작업 목록(게시판) 조회용 스키마 — 장비 정보를 포함한 행 1개."""
    id: int
    device_id: int
    device_name: str
    device_ip: str
    task_type: AnalysisTaskType
    task_status: AnalysisTaskStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None

class AnalysisTaskListResponse(BaseModel):
    items: List[AnalysisTaskListItem]
    total: int
