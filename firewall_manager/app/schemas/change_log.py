from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime

class ChangeLogBase(BaseModel):
    device_id: int
    data_type: str
    object_name: str
    action: str
    details: Optional[Any] = None

class ChangeLogCreate(ChangeLogBase):
    pass

class ChangeLog(ChangeLogBase):
    id: int
    timestamp: datetime

    class Config:
        from_attributes = True
