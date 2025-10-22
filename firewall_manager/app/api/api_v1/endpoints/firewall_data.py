# firewall_manager/app/api/api_v1/endpoints/firewall_data.py
import logging
from typing import Any, List
import asyncio
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
import json

from app import crud, models, schemas
from app.db.session import get_db, SessionLocal
from app.core.security import fernet
from app.services.firewall.factory import FirewallCollectorFactory
from app.services.firewall.interface import FirewallInterface

router = APIRouter()

def dataframe_to_pydantic(df: pd.DataFrame, pydantic_model):
    """Converts a Pandas DataFrame to a list of Pydantic models."""
    df.columns = [col.lower().replace(' ', '_') for col in df.columns]
    rename_map = {
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

def get_key_attribute(data_type: str) -> str:
    """Returns the key attribute for a given data type."""
    return "rule_name" if data_type == "policies" else "name"

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

        await crud.device.update_sync_status(db=db, device=device, status="in_progress")
        collector = None
        try:
            collector = await _get_collector(device)
            loop = asyncio.get_running_loop()

            sync_map = {
                "policies": (collector.export_security_rules, crud.policy.get_policies_by_device, crud.policy.create_policies, crud.policy.update_policy, crud.policy.delete_policy, schemas.PolicyCreate),
                "network_objects": (collector.export_network_objects, crud.network_object.get_network_objects_by_device, crud.network_object.create_network_objects, crud.network_object.update_network_object, crud.network_object.delete_network_object, schemas.NetworkObjectCreate),
                "network_groups": (collector.export_network_group_objects, crud.network_group.get_network_groups_by_device, crud.network_group.create_network_groups, crud.network_group.update_network_group, crud.network_group.delete_network_group, schemas.NetworkGroupCreate),
                "services": (collector.export_service_objects, crud.service.get_services_by_device, crud.service.create_services, crud.service.update_service, crud.service.delete_service, schemas.ServiceCreate),
                "service_groups": (collector.export_service_group_objects, crud.service_group.get_service_groups_by_device, crud.service_group.create_service_groups, crud.service_group.update_service_group, crud.service_group.delete_service_group, schemas.ServiceGroupCreate),
            }

            if data_type not in sync_map:
                logging.error(f"Invalid data type for synchronization: {data_type}")
                await crud.device.update_sync_status(db=db, device_id=device_id, status="failure")
                return

            export_func, get_all_func, create_func, update_func, delete_func, schema_create = sync_map[data_type]

            df = await loop.run_in_executor(None, export_func)
            df['device_id'] = device_id
            items_to_sync = dataframe_to_pydantic(df, schema_create)

            existing_items = await get_all_func(db=db, device_id=device_id)
            key_attribute = get_key_attribute(data_type)
            existing_items_map = {getattr(item, key_attribute): item for item in existing_items}
            items_to_sync_map = {getattr(item, key_attribute): item for item in items_to_sync}

            items_to_create = []

            # Handle created and updated items
            for item_name, item_in in items_to_sync_map.items():
                existing_item = existing_items_map.get(item_name)
                if existing_item:
                    # Update
                    obj_data = item_in.model_dump()
                    db_obj_data = {c.name: getattr(existing_item, c.name) for c in existing_item.__table__.columns}
                    if any(obj_data.get(k) != db_obj_data.get(k) for k in obj_data):
                        await update_func(db=db, db_obj=existing_item, obj_in=item_in)
                        await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device_id, data_type=data_type, object_name=item_name, action="updated", details=json.dumps({"before": db_obj_data, "after": obj_data}, default=str)))
                else:
                    # Create
                    items_to_create.append(item_in)

            if items_to_create:
                await create_func(db=db, **{f"{data_type}": items_to_create})
                for item_in in items_to_create:
                    await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device_id, data_type=data_type, object_name=getattr(item_in, key_attribute), action="created", details=json.dumps(item_in.model_dump())))

            # Handle deleted items
            for item_name, item in existing_items_map.items():
                if item_name not in items_to_sync_map:
                    await delete_func(db=db, **{f"{get_singular_name(data_type)}": item})
                    await crud.change_log.create_change_log(db=db, change_log=schemas.ChangeLogCreate(device_id=device_id, data_type=data_type, object_name=item_name, action="deleted"))

            await crud.device.update_sync_status(db=db, device=device, status="success")
            await db.commit()

        except NotImplementedError:
            logging.warning(f"{data_type} synchronization not supported for device {device.name} ({device.vendor}).")
            await crud.device.update_sync_status(db=db, device=device, status="not_supported")
            await db.commit()
        except Exception as e:
            await db.rollback()
            logging.error(f"Failed to sync {data_type} for device {device.name}: {e}", exc_info=True)
            # Fetch a new device object for the new session
            device_for_status_update = await crud.device.get_device(db=db, device_id=device_id)
            await crud.device.update_sync_status(db=db, device=device_for_status_update, status="failure")
            await db.commit()
        finally:
            if collector:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, collector.disconnect)

@router.post("/sync/{device_id}/{data_type}", response_model=schemas.Msg)
async def sync_device_data(device_id: int, data_type: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    device = await crud.device.get_device(db=db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    background_tasks.add_task(_sync_data_task, device_id, data_type)
    return {"msg": f"{data_type.replace('_', ' ').title()} synchronization started in the background."}

@router.get("/{device_id}/policies", response_model=List[schemas.Policy])
async def read_db_device_policies(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.policy.get_policies_by_device(db=db, device_id=device_id)

@router.get("/{device_id}/network-objects", response_model=List[schemas.NetworkObject])
async def read_db_device_network_objects(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.network_object.get_network_objects_by_device(db=db, device_id=device_id)

@router.get("/{device_id}/network-groups", response_model=List[schemas.NetworkGroup])
async def read_db_device_network_groups(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.network_group.get_network_groups_by_device(db=db, device_id=device_id)

@router.get("/{device_id}/services", response_model=List[schemas.Service])
async def read_db_device_services(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.service.get_services_by_device(db=db, device_id=device_id)

@router.get("/{device_id}/service-groups", response_model=List[schemas.ServiceGroup])
async def read_db_device_service_groups(device_id: int, db: AsyncSession = Depends(get_db)):
    return await crud.service_group.get_service_groups_by_device(db=db, device_id=device_id)
