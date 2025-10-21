# firewall_manager/app/api/api_v1/endpoints/analysis.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.db.session import get_db
from app.services import analysis_service

router = APIRouter()

@router.get(
    "/{device_id}/duplicate-policies",
    response_model=List[schemas.DuplicatePolicyGroup]
)
async def get_duplicate_policies(
    device_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieve and analyze security policies for a device to find duplicates.
    """
    duplicate_groups = await analysis_service.find_duplicate_policies(
        db=db, device_id=device_id
    )

    if not duplicate_groups:
        return []

    # Transform the data into the response model structure
    response_data = [
        {"policies": group} for group in duplicate_groups
    ]
    return response_data
