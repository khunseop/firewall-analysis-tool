from typing import Optional
from datetime import datetime
from pydantic import BaseModel

class NotificationLogBase(BaseModel):
    title: str
    message: str
    type: str  # 'info', 'success', 'warning', 'error'
    category: Optional[str] = None  # 'sync', 'analysis', 'system'
    device_id: Optional[int] = None
    device_name: Optional[str] = None

class NotificationLogCreate(NotificationLogBase):
    pass

class NotificationLog(NotificationLogBase):
    id: int
    timestamp: datetime

    class Config:
        from_attributes = True

class NotificationLogListResponse(BaseModel):
    items: list[NotificationLog]
    total: int

