from pydantic import BaseModel
from typing import List, Optional

class ObjectSearchRequest(BaseModel):
    device_ids: List[int]
    object_type: str  # 'network_object', 'network_group', 'service', 'service_group'

    # Common fields
    name: Optional[str] = None
    description: Optional[str] = None

    # NetworkObject specific
    ip_address: Optional[str] = None
    type: Optional[str] = None

    # Group specific
    members: Optional[str] = None # Member names, comma-separated

    # Service specific
    protocol: Optional[str] = None
    port: Optional[str] = None

    class Config:
        from_attributes = True
