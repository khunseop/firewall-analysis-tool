from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict


ChangeType = Literal["create", "new_object", "modify", "delete", "move"]


class PendingPolicyChangeCreate(BaseModel):
    change_type: ChangeType
    target_policy_id: Optional[int] = None
    client_key: str
    payload: Dict[str, Any] = {}


class PendingPolicyChangeUpdate(BaseModel):
    """기존 대기중 변경사항의 payload를 부분 갱신(merge)한다.

    예: create 행의 배치 위치(position/reference_policy_id)를 "선택 이동"으로 바꾸거나,
    그리드에서 신규 생성행의 필드 값을 직접 편집했을 때 사용."""
    payload: Dict[str, Any]


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
