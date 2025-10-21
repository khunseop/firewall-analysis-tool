from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# Base schema for service attributes
class ServiceBase(BaseModel):
    name: str
    protocol: Optional[str] = None
    port: Optional[str] = None
    description: Optional[str] = None

# Schema for creating a new service
class ServiceCreate(ServiceBase):
    device_id: int

# Schema for reading service data (from DB)
class Service(ServiceBase):
    id: int
    device_id: int
    is_active: bool
    last_seen_at: datetime

    class Config:
        from_attributes = True
