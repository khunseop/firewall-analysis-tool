from pydantic import BaseModel
import datetime

class HitCountBase(BaseModel):
    hit_count: int
    last_hit_at: datetime.datetime

class HitCountCreate(HitCountBase):
    policy_id: int

class HitCount(HitCountBase):
    id: int
    policy_id: int

    class Config:
        from_attributes = True