from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime

class SyncScheduleBase(BaseModel):
    name: str
    enabled: bool = True
    days_of_week: List[int]  # [0,1,2,3,4,5,6] (월~일, 0=월요일)
    time: str  # "HH:MM" 형식
    device_ids: List[int]  # 장비 ID 목록
    description: Optional[str] = None

    @field_validator('days_of_week')
    @classmethod
    def validate_days_of_week(cls, v):
        if not v or not isinstance(v, list):
            raise ValueError('days_of_week must be a non-empty list')
        if not all(isinstance(d, int) and 0 <= d <= 6 for d in v):
            raise ValueError('days_of_week must contain integers between 0 and 6 (0=Monday, 6=Sunday)')
        return sorted(set(v))  # 중복 제거 및 정렬

    @field_validator('time')
    @classmethod
    def validate_time(cls, v):
        try:
            hour, minute = map(int, v.split(':'))
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError('Hour must be 0-23 and minute must be 0-59')
            return f"{hour:02d}:{minute:02d}"
        except (ValueError, AttributeError):
            raise ValueError('time must be in HH:MM format')

    @field_validator('device_ids')
    @classmethod
    def validate_device_ids(cls, v):
        if not v or not isinstance(v, list):
            raise ValueError('device_ids must be a non-empty list')
        if not all(isinstance(d, int) and d > 0 for d in v):
            raise ValueError('device_ids must contain positive integers')
        return v

class SyncScheduleCreate(SyncScheduleBase):
    pass

class SyncScheduleUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    days_of_week: Optional[List[int]] = None
    time: Optional[str] = None
    device_ids: Optional[List[int]] = None
    description: Optional[str] = None

    @field_validator('days_of_week')
    @classmethod
    def validate_days_of_week(cls, v):
        if v is None:
            return v
        if not isinstance(v, list):
            raise ValueError('days_of_week must be a list')
        if not all(isinstance(d, int) and 0 <= d <= 6 for d in v):
            raise ValueError('days_of_week must contain integers between 0 and 6')
        return sorted(set(v))

    @field_validator('time')
    @classmethod
    def validate_time(cls, v):
        if v is None:
            return v
        try:
            hour, minute = map(int, v.split(':'))
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError('Hour must be 0-23 and minute must be 0-59')
            return f"{hour:02d}:{minute:02d}"
        except (ValueError, AttributeError):
            raise ValueError('time must be in HH:MM format')

    @field_validator('device_ids')
    @classmethod
    def validate_device_ids(cls, v):
        if v is None:
            return v
        if not isinstance(v, list):
            raise ValueError('device_ids must be a list')
        if not all(isinstance(d, int) and d > 0 for d in v):
            raise ValueError('device_ids must contain positive integers')
        return v

class SyncSchedule(SyncScheduleBase):
    id: int
    created_at: datetime
    updated_at: datetime
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None

    class Config:
        from_attributes = True

