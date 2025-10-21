# firewall_manager/app/api/api_v1/endpoints/firewall_data.py
import logging
from typing import Any, List
import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, models, schemas
from app.db.session import get_db, SessionLocal
from app.core.security import fernet
from app.services.firewall.factory import FirewallCollectorFactory
from app.services.firewall.interface import FirewallInterface

router = APIRouter()

async def _get_collector(device: models.Device) -> FirewallInterface:
    """Helper function to create and connect a firewall collector."""
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

    loop = asyncio.get_running_loop()
    if not await loop.run_in_executor(None, collector.connect):
        raise HTTPException(status_code=500, detail="Failed to connect to the firewall device")

    return collector

async def _sync_policies_task(device_id: int):
    """Background task to synchronize policies for a device."""
    async with SessionLocal() as db:
        device = await crud.device.get_device(db=db, device_id=device_id)
        if not device:
            # Log error or handle appropriately
            return

        collector = await _get_collector(device)
        try:
            loop = asyncio.get_running_loop()
            policies_df = await loop.run_in_executor(None, collector.export_security_rules)

            # Rename columns to match the Pydantic model's field names
            policies_df.rename(columns={
                'Rule Name': 'rule_name',
                'Source': 'source_ip',
                'Destination': 'destination_ip',
                'Service': 'service',
                'Action': 'action',
                'Description': 'description'
            }, inplace=True)

            # Convert DataFrame to list of Pydantic models
            policies_to_create = [
                schemas.PolicyCreate(**policy, device_id=device_id)
                for policy in policies_df.to_dict(orient='records')
            ]

            # Clear old policies and create new ones
            await crud.policy.delete_policies_by_device(db=db, device_id=device_id)
            await crud.policy.create_policies(db=db, policies=policies_to_create)

        except Exception as e:
            # Log the exception
            logging.error(f"Failed to sync policies for device {device.name}: {e}")
        finally:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, collector.disconnect)

async def _sync_network_objects_task(device_id: int):
    """Background task to synchronize network objects for a device."""
    async with SessionLocal() as db:
        device = await crud.device.get_device(db=db, device_id=device_id)
        if not device:
            return

        collector = await _get_collector(device)
        try:
            loop = asyncio.get_running_loop()
            objects_df = await loop.run_in_executor(None, collector.export_network_objects)

            # Rename columns to match the Pydantic model's field names
            objects_df.rename(columns={
                'Name': 'name',
                'IP Address': 'ip_address',
                'Description': 'description'
            }, inplace=True)

            objects_to_create = [
                schemas.NetworkObjectCreate(**obj, device_id=device_id)
                for obj in objects_df.to_dict(orient='records')
            ]

            await crud.network_object.delete_network_objects_by_device(db=db, device_id=device_id)
            await crud.network_object.create_network_objects(db=db, network_objects=objects_to_create)

        except Exception as e:
            logging.error(f"Failed to sync network objects for device {device.name}: {e}")
        finally:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, collector.disconnect)

@router.post("/sync/{device_id}/policies", response_model=schemas.Msg)
async def sync_device_policies(
    device_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger a background task to synchronize policies from a device."""
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    background_tasks.add_task(_sync_policies_task, device_id)
    return {"msg": "Policy synchronization started in the background."}

@router.post("/sync/{device_id}/network-objects", response_model=schemas.Msg)
async def sync_device_network_objects(
    device_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger a background task to synchronize network objects from a device."""
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    background_tasks.add_task(_sync_network_objects_task, device_id)
    return {"msg": "Network object synchronization started in the background."}

@router.get("/{device_id}/policies", response_model=List[schemas.Policy])
async def read_db_device_policies(
    device_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Retrieve security policies for a device from the local database."""
    policies = await crud.policy.get_policies_by_device(db=db, device_id=device_id)
    return policies

@router.get("/{device_id}/network-objects", response_model=List[schemas.NetworkObject])
async def read_db_device_network_objects(
    device_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Retrieve network objects for a device from the local database."""
    network_objects = await crud.network_object.get_network_objects_by_device(db=db, device_id=device_id)
    return network_objects
