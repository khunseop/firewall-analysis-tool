from pydantic import BaseModel

class PolicyBase(BaseModel):
    name: str | None = None
    source_ip: str | None = None
    destination_ip: str | None = None
    service: str | None = None
    action: str | None = None
    raw_policy: str | None = None

class PolicyCreate(PolicyBase):
    pass

class Policy(PolicyBase):
    id: int
    device_id: int

    class Config:
        from_attributes = True