from pydantic import BaseModel

class FirewallObjectBase(BaseModel):
    name: str | None = None
    object_type: str | None = None
    value: str | None = None

class FirewallObjectCreate(FirewallObjectBase):
    pass

class FirewallObject(FirewallObjectBase):
    id: int
    device_id: int

    class Config:
        from_attributes = True