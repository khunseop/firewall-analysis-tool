# firewall_manager/app/schemas/analysis.py
from typing import List
from pydantic import BaseModel
from .policy import Policy

class DuplicatePolicyGroup(BaseModel):
    """
    Represents a group of security policies that are considered duplicates
    because they share the same source, destination, service, and action.
    """
    policies: List[Policy]
