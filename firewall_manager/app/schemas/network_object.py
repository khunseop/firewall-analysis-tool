# firewall_manager/app/schemas/network_object.py
from pydantic import BaseModel
from typing import Optional

class NetworkObjectBase(BaseModel):
    Name: Optional[str] = None
    Type: Optional[str] = None
    Value: Optional[str] = None

class NetworkObject(NetworkObjectBase):
    pass

class NetworkObjectInDBBase(NetworkObjectBase):
    class Config:
        from_attributes = True

class NetworkObjectInDB(NetworkObjectInDBBase):
    pass
