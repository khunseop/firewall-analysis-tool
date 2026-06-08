from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class SyncHistoryBase(BaseModel):
    device_id: int
    sync_at: datetime
    total_policies: Optional[int] = None
    created_count: int = 0
    updated_count: int = 0
    deleted_count: int = 0


class SyncHistoryCreate(SyncHistoryBase):
    pass


class SyncHistory(SyncHistoryBase):
    id: int

    class Config:
        from_attributes = True


class PolicyFieldChange(BaseModel):
    field: str
    before: Optional[str] = None
    after: Optional[str] = None


class PolicyDiffEntry(BaseModel):
    rule_name: str
    vsys: Optional[str] = None
    action: str  # "created" | "updated" | "deleted"
    field_changes: List[PolicyFieldChange] = []
    before: Optional[dict] = None
    after: Optional[dict] = None


class PolicyDiffResponse(BaseModel):
    from_sync: SyncHistory
    to_sync: SyncHistory
    summary: dict
    changes: List[PolicyDiffEntry]
