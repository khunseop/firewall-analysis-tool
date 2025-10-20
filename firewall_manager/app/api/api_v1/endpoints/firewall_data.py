# firewall_manager/app/api/api_v1/endpoints/firewall_data.py
from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
import pandas as pd

from app import crud, models, schemas
from app.db.session import get_db
from app.core.security import fernet
from app.services.firewall.factory import FirewallCollectorFactory

router = APIRouter()


@router.get("/{device_id}/policies", response_model=List[schemas.Policy])
async def read_device_policies(
    device_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    Retrieve security policies from a specific device.
    """
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    try:
        decrypted_password = fernet.decrypt(device.password.encode()).decode()
    except Exception:
        raise HTTPException(status_code=500, detail="Password decryption failed")

    collector = FirewallCollectorFactory.get_collector(
        source_type=device.vendor.lower(),
        hostname=device.ip_address,
        username=device.username,
        password=decrypted_password,
    )

    if not collector.connect():
        raise HTTPException(status_code=500, detail="Failed to connect to the firewall device")

    try:
        policies_df = collector.export_security_rules()
        # DataFrame을 JSON 직렬화 가능한 dict 리스트로 변환
        policies_data = policies_df.to_dict(orient='records')
        return policies_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch policies: {str(e)}")
    finally:
        collector.disconnect()

@router.get("/{device_id}/network-objects", response_model=List[schemas.NetworkObject])
async def read_device_network_objects(
    device_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    Retrieve network objects from a specific device.
    """
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    try:
        decrypted_password = fernet.decrypt(device.password.encode()).decode()
    except Exception:
        raise HTTPException(status_code=500, detail="Password decryption failed")

    collector = FirewallCollectorFactory.get_collector(
        source_type=device.vendor.lower(),
        hostname=device.ip_address,
        username=device.username,
        password=decrypted_password,
    )

    if not collector.connect():
        raise HTTPException(status_code=500, detail="Failed to connect to the firewall device")

    try:
        objects_df = collector.export_network_objects()
        objects_data = objects_df.to_dict(orient='records')
        return objects_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch network objects: {str(e)}")
    finally:
        collector.disconnect()
