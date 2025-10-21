# firewall_manager/app/services/analysis_service.py
from collections import defaultdict
from typing import List, Dict
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas

async def find_duplicate_policies(
    db: AsyncSession, device_id: int
) -> List[List[schemas.Policy]]:
    """
    Finds and groups duplicate security policies for a given device.

    A policy is considered a duplicate if it has the same source_ip,
    destination_ip, service, and action as another policy.

    Args:
        db: The database session.
        device_id: The ID of the device to analyze.

    Returns:
        A list of lists, where each inner list contains a group of
        duplicate policies.
    """
    policies = await crud.policy.get_policies_by_device(db=db, device_id=device_id)

    policy_map = defaultdict(list)
    for policy in policies:
        # Create a unique key based on the duplication criteria
        key = (
            policy.source_ip,
            policy.destination_ip,
            policy.service,
            policy.action,
        )
        policy_map[key].append(policy)

    # Filter out non-duplicates (groups with only one policy)
    duplicate_groups = [
        group for group in policy_map.values() if len(group) > 1
    ]

    return duplicate_groups
