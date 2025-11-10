from pydantic import BaseModel
from typing import Optional, List, Union, Any
from datetime import datetime

from .network_object import NetworkObject
from .network_group import NetworkGroup
from .service import Service
from .service_group import ServiceGroup

# Request schema for object search with multi-device and multi-value filters
class ObjectSearchRequest(BaseModel):
    # Multi-device selection
    device_ids: List[int]
    
    # Object type to search
    object_type: str  # 'network-objects', 'network-groups', 'services', 'service-groups'
    
    # Common filters (substring match)
    name: Optional[str] = None  # Single name or comma-separated names
    description: Optional[str] = None
    
    # Network Object specific filters
    ip_address: Optional[str] = None  # Single IP or comma-separated IPs
    type: Optional[str] = None  # Object type (e.g., 'ip', 'range', 'fqdn')
    
    # Network Group specific filters
    members: Optional[str] = None  # Member name search (substring match)
    
    # Service Object specific filters
    protocol: Optional[str] = None  # Single protocol or comma-separated protocols
    port: Optional[str] = None  # Single port or comma-separated ports
    
    # Service Group specific filters (members is already defined above)
    
    # Multi-value filters (OR semantics)
    names: Optional[List[str]] = None  # Multiple names
    ip_addresses: Optional[List[str]] = None  # Multiple IP addresses
    protocols: Optional[List[str]] = None  # Multiple protocols
    ports: Optional[List[str]] = None  # Multiple ports
    
    # Paging (optional)
    skip: Optional[int] = None
    limit: Optional[int] = None

# Response schema for object search
class ObjectSearchResponse(BaseModel):
    network_objects: List[NetworkObject] = []
    network_groups: List[NetworkGroup] = []
    services: List[Service] = []
    service_groups: List[ServiceGroup] = []
    
    class Config:
        from_attributes = True

