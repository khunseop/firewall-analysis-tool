# firewall_manager/app/schemas/policy.py
from pydantic import BaseModel
from typing import Optional

class PolicyBase(BaseModel):
    Vsys: Optional[str] = None
    Seq: Optional[int] = None
    Rule_Name: Optional[str] = None
    Enable: Optional[str] = None
    Action: Optional[str] = None
    Source: Optional[str] = None
    User: Optional[str] = None
    Destination: Optional[str] = None
    Service: Optional[str] = None
    Application: Optional[str] = None
    Security_Profile: Optional[str] = None
    Category: Optional[str] = None
    Description: Optional[str] = None

class Policy(PolicyBase):
    pass

class PolicyInDBBase(PolicyBase):
    class Config:
        from_attributes = True

class PolicyInDB(PolicyInDBBase):
    pass
