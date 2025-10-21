# firewall_manager/app/api/api_v1/endpoints/firewall_data.py
import logging
from typing import Any, List
import asyncio
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, models, schemas
from app.db.session import get_db, SessionLocal
from app.core.security import fernet
from app.services.firewall.factory import FirewallCollectorFactory
from app.services.firewall.interface import FirewallInterface

router = APIRouter()

def dataframe_to_pydantic(df: pd.DataFrame, pydantic_model):
    """Converts a Pandas DataFrame to a list of Pydantic models."""
    df.columns = [col.lower().replace(' ', '_') for col in df.columns]
    # Rename columns to match Pydantic model fields
    rename_map = {
        "rule_name": "rule_name",
        "group_name": "name",
        "entry": "members",
        "value": "ip_address",
        "port": "port",
    }
    df = df.rename(columns=rename_map)
    return [pydantic_model(**row) for row in df.to_dict(orient='records')]

def get_singular_name(plural_name: str) -> str:
    """Converts plural data type string to singular form for CRUD operations."""
    if plural_name == "policies":
        return "policy"
    return plural_name[:-1]

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

async def _sync_data_task(device_id: int, data_type: str):
    """Generic background task to synchronize data for a device."""
    async with SessionLocal() as db:
        device = await crud.device.get_device(db=db, device_id=device_id)
        if not device:
            logging.error(f"Device with id {device_id} not found.")
            return

        await crud.device.update_sync_status(db=db, device_id=device_id, status="in_progress")
        collector = None
        try:
            collector = await _get_collector(device)
            loop = asyncio.get_running_loop()

            sync_map = {
                "policies": (
                    collector.export_security_rules,
                    crud.policy.get_all_active_policies_by_device,
                    crud.policy.create_policies,
                    crud.policy.update_policy,
                    crud.policy.mark_policies_as_inactive,
                    schemas.PolicyCreate
                ),
                "network_objects": (
                    collector.export_network_objects,
                    crud.network_object.get_all_active_network_objects_by_device,
                    crud.network_object.create_network_objects,
                    crud.network_object.update_network_object,
                    crud.network_object.mark_network_objects_as_inactive,
                    schemas.NetworkObjectCreate
                ),
                "network_groups": (
                    collector.export_network_group_objects,
                    crud.network_group.get_all_active_network_groups_by_device,
                    crud.network_group.create_network_groups,
                    crud.network_group.update_network_group,
                    crud.network_group.mark_network_groups_as_inactive,
                    schemas.NetworkGroupCreate
                ),
                "services": (
                    collector.export_service_objects,
                    crud.service.get_all_active_services_by_device,
                    crud.service.create_services,
                    crud.service.update_service,
                    crud.service.mark_services_as_inactive,
                    schemas.ServiceCreate
                ),
                "service_groups": (
                    collector.export_service_group_objects,
                    crud.service_group.get_all_active_service_groups_by_device,
                    crud.service_group.create_service_groups,
                    crud.service_group.update_service_group,
                    crud.service_group.mark_service_groups_as_inactive,
                    schemas.ServiceGroupCreate
                ),
            }

            if data_type not in sync_map:
                logging.error(f"Invalid data type for synchronization: {data_type}")
                await crud.device.update_sync_status(db=db, device_id=device_id, status="failure")
                return

            export_func, get_all_func, create_func, update_func, mark_inactive_func, schema_create = sync_map[data_type]

            df = await loop.run_in_executor(None, export_func)

            df['device_id'] = device_id

            items_to_sync = dataframe_to_pydantic(df, schema_create)

            existing_items = await get_all_func(db=db, device_id=device_id)
            existing_items_map = {item.name: item for item in existing_items}

            seen_item_ids = set()
            items_to_create = []
            singular_name = get_singular_name(data_type)

            for item_in in items_to_sync:
                existing_item = existing_items_map.get(item_in.name)
                if existing_item:
                    update_kwargs = {singular_name: existing_item, f"{singular_name}_in": item_in}
                    await update_func(db=db, **update_kwargs)
                    seen_item_ids.add(existing_item.id)
                else:
                    items_to_create.append(item_in)

            if items_to_create:
                await create_func(db=db, **{f"{data_type}": items_to_create})

            mark_inactive_kwargs = {f"{singular_name}_ids_to_keep": seen_item_ids}
            await mark_inactive_func(db=db, device_id=device_id, **mark_inactive_kwargs)
            await crud.device.update_sync_status(db=db, device_id=device_id, status="success")

        except NotImplementedError:
            logging.warning(f"{data_type} synchronization not supported for device {device.name} ({device.vendor}).")
            await crud.device.update_sync_status(db=db, device_id=device_id, status="not_supported")
        except Exception as e:
            logging.error(f"Failed to sync {data_type} for device {device.name}: {e}")
            await crud.device.update_sync_status(db=db, device_id=device_id, status="failure")
        finally:
            if collector:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, collector.disconnect)

@router.post("/sync/{device_id}/{data_type}", response_model=schemas.Msg)
async def sync_device_data(
    device_id: int,
    data_type: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger a background task to synchronize a specific data type from a device."""
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    background_tasks.add_task(_sync_data_task, device_id, data_type)
    return {"msg": f"{data_type.replace('_', ' ').title()} synchronization started in the background."}

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

@router.get("/{device_id}/network-groups", response_model=List[schemas.NetworkGroup])
async def read_db_device_network_groups(
    device_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Retrieve network groups for a device from the local database."""
    network_groups = await crud.network_group.get_network_groups_by_device(db=db, device_id=device_id)
    return network_groups

@router.get("/{device_id}/services", response_model=List[schemas.Service])
async def read_db_device_services(
    device_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Retrieve services for a device from the local database."""
    services = await crud.service.get_services_by_device(db=db, device_id=device_id)
    return services

@router.get("/{device_id}/service-groups", response_model=List[schemas.ServiceGroup])
async def read_db_device_service_groups(
    device_id: int,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Retrieve service groups for a device from the local database."""
    service_groups = await crud.service_group.get_service_groups_by_device(db=db, device_id=device_id)
    return service_groups
