from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict


ChangeType = Literal["create", "new_object", "modify", "delete", "move"]


class PendingPolicyChangeCreate(BaseModel):
    change_type: ChangeType
    target_policy_id: Optional[int] = None
    client_key: str
    payload: Dict[str, Any] = {}


class PendingPolicyChange(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: int
    change_type: ChangeType
    target_policy_id: Optional[int] = None
    client_key: str
    payload: Dict[str, Any]
    created_by_user_id: Optional[int] = None
    created_at: datetime
